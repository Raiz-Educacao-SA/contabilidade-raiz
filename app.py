import io
import json
import re
import shutil
import unicodedata
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st


st.set_page_config(
    page_title="Conciliação Bancária Automática",
    page_icon="🏦",
    layout="wide",
)


APP_DIR = Path(__file__).resolve().parent
DATA_DIR = APP_DIR / "dados"
EXTRATOS_DIR = DATA_DIR / "extratos"
SALDOS_FILE = DATA_DIR / "saldos.json"
DATA_DIR.mkdir(exist_ok=True)
EXTRATOS_DIR.mkdir(exist_ok=True)


def safe_filename(value):
    value = normalize_text(value) if "normalize_text" in globals() else str(value)
    value = re.sub(r"[^A-Z0-9._-]+", "_", value)
    return value.strip("_") or "arquivo"


def load_balances():
    if not SALDOS_FILE.exists():
        return {}
    try:
        return json.loads(SALDOS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_balances(data):
    SALDOS_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def competence_key(value):
    return pd.Timestamp(value).strftime("%Y-%m")


def previous_competence(value):
    period = pd.Period(pd.Timestamp(value), freq="M") - 1
    return str(period)


def balance_record_key(account, competence):
    return f"{account}||{competence}"


def inherited_opening_balance(account, competence, balances):
    previous = previous_competence(competence)
    record = balances.get(balance_record_key(account, previous), {})
    if record.get("fixar_para_mes_seguinte"):
        return float(record.get("saldo_final", 0.0))
    return 0.0


def store_uploaded_statement(uploaded_file, competence, account):
    target_dir = EXTRATOS_DIR / competence / safe_filename(account)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / safe_filename(uploaded_file.name)
    uploaded_file.seek(0)
    target.write_bytes(uploaded_file.read())
    uploaded_file.seek(0)
    return target


def list_stored_statements(competence):
    root = EXTRATOS_DIR / competence
    if not root.exists():
        return []
    return sorted([p for p in root.rglob("*") if p.is_file()])


def normalize_text(value):
    if pd.isna(value):
        return ""
    text = str(value).strip().upper()
    text = unicodedata.normalize("NFKD", text)
    return "".join(c for c in text if not unicodedata.combining(c))


def money_br(value):
    try:
        return f"R$ {float(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except Exception:
        return "R$ 0,00"


def read_excel_raw(uploaded_file, sheet_name=0):
    uploaded_file.seek(0)
    return pd.read_excel(uploaded_file, sheet_name=sheet_name, header=None, engine="openpyxl")


def list_excel_sheets(uploaded_file):
    uploaded_file.seek(0)
    return pd.ExcelFile(uploaded_file, engine="openpyxl").sheet_names


def detect_header_row(df, required_terms):
    best_row = None
    best_score = 0
    for idx in range(min(len(df), 40)):
        values = [normalize_text(v) for v in df.iloc[idx].tolist()]
        joined = " | ".join(values)
        score = sum(1 for term in required_terms if term in joined)
        if score > best_score:
            best_score = score
            best_row = idx
    return best_row if best_score >= 2 else None


def parse_accounting_file(uploaded_file):
    sheets = list_excel_sheets(uploaded_file)
    candidates = []

    for sheet in sheets:
        raw = read_excel_raw(uploaded_file, sheet)
        header_row = detect_header_row(raw, ["DESCRICAO", "CODCONTA", "DATA", "DEBITO", "CREDITO"])
        if header_row is None:
            continue

        headers = [normalize_text(v) or f"COL_{i}" for i, v in enumerate(raw.iloc[header_row].tolist())]
        df = raw.iloc[header_row + 1:].copy()
        df.columns = headers
        df = df.dropna(how="all")

        column_map = {}
        for col in df.columns:
            n = normalize_text(col)
            if n in ("DESCRICAO", "DESCRICAO DA CONTA") or "DESCRICAO" in n:
                column_map.setdefault("descricao", col)
            if n == "CODCONTA" or "CODCONTA" in n or "CONTA CONTABIL" in n:
                column_map.setdefault("conta", col)
            if "DATACOMPENSACAO" in n or n == "DATA" or "DATA COMPENSACAO" in n:
                column_map.setdefault("data", col)
            if n == "DEBITO":
                column_map.setdefault("debito", col)
            if n == "CREDITO":
                column_map.setdefault("credito", col)
            if n == "CODCOLPROP" or "COLIGADA" in n:
                column_map.setdefault("coligada", col)

        required = {"descricao", "conta", "data", "debito", "credito"}
        if not required.issubset(column_map):
            continue

        out = pd.DataFrame({
            "coligada": df[column_map["coligada"]] if "coligada" in column_map else "",
            "conta_contabil": df[column_map["conta"]].astype(str).str.strip(),
            "descricao_conta": df[column_map["descricao"]].astype(str).str.strip(),
            "data": pd.to_datetime(df[column_map["data"]], errors="coerce", dayfirst=True),
            "debito": pd.to_numeric(df[column_map["debito"]], errors="coerce").fillna(0.0),
            "credito": pd.to_numeric(df[column_map["credito"]], errors="coerce").fillna(0.0),
            "aba_origem": sheet,
        })
        out = out[out["data"].notna()]
        out = out[(out["debito"].abs() > 0.004) | (out["credito"].abs() > 0.004)]
        candidates.append(out)

    if not candidates:
        raise ValueError(
            "Não encontrei uma aba com as colunas de conta, descrição, data, débito e crédito."
        )

    accounting = pd.concat(candidates, ignore_index=True)
    accounting["chave_conta"] = (
        accounting["conta_contabil"].fillna("") + " — " + accounting["descricao_conta"].fillna("")
    )
    return accounting


def extract_metadata(raw):
    meta = {"agencia": "", "conta": "", "periodo": "", "nome": ""}
    for idx in range(min(len(raw), 15)):
        row = [str(v).strip() if not pd.isna(v) else "" for v in raw.iloc[idx].tolist()]
        if not row:
            continue
        label = normalize_text(row[0])
        value = row[1] if len(row) > 1 else ""
        if label.startswith("AGENCIA"):
            meta["agencia"] = value
        elif label.startswith("CONTA"):
            meta["conta"] = value
        elif label.startswith("PERIODO"):
            meta["periodo"] = value
        elif label.startswith("NOME"):
            meta["nome"] = value
    return meta


def parse_bank_file(uploaded_file):
    sheets = list_excel_sheets(uploaded_file)
    best = None

    for sheet in sheets:
        raw = read_excel_raw(uploaded_file, sheet)
        header_row = detect_header_row(raw, ["DATA", "LANCAMENTO", "VALOR"])
        if header_row is None:
            continue

        meta = extract_metadata(raw)
        headers = [normalize_text(v) or f"COL_{i}" for i, v in enumerate(raw.iloc[header_row].tolist())]
        df = raw.iloc[header_row + 1:].copy()
        df.columns = headers
        df = df.dropna(how="all")

        date_col = next((c for c in df.columns if normalize_text(c) == "DATA"), None)
        desc_col = next(
            (c for c in df.columns if "LANCAMENTO" in normalize_text(c) or "HISTORICO" in normalize_text(c) or "DESCRICAO" in normalize_text(c)),
            None,
        )
        value_col = next(
            (c for c in df.columns if "VALOR" in normalize_text(c) and "SALDO" not in normalize_text(c)),
            None,
        )

        if not all([date_col, desc_col, value_col]):
            continue

        out = pd.DataFrame({
            "data": pd.to_datetime(df[date_col], errors="coerce", dayfirst=True),
            "historico": df[desc_col].astype(str).str.strip(),
            "valor": pd.to_numeric(df[value_col], errors="coerce"),
            "arquivo_extrato": uploaded_file.name,
            "aba_origem": sheet,
        })
        out = out[out["data"].notna() & out["valor"].notna()]
        out["historico_normalizado"] = out["historico"].map(normalize_text)

        ignore_patterns = [
            "SALDO ANTERIOR",
            "SALDO TOTAL",
            "SALDO DISPONIVEL",
            "SALDO DO DIA",
        ]
        mask_ignore = out["historico_normalizado"].apply(
            lambda x: any(p in x for p in ignore_patterns)
        )
        out = out[~mask_ignore].copy()
        out = out[out["valor"].abs() > 0.004]

        if len(out):
            best = (out.reset_index(drop=True), meta)
            break

    if best is None:
        raise ValueError(
            "Não consegui identificar as colunas Data, Lançamento/Histórico e Valor no extrato."
        )
    return best


def accounting_transactions(accounting, selected_account):
    selected = accounting[accounting["chave_conta"] == selected_account].copy()
    rows = []
    for idx, row in selected.iterrows():
        if abs(row["debito"]) > 0.004:
            rows.append({
                "id_contabil": f"C{idx}-D",
                "data_contabil": row["data"].normalize(),
                "valor_contabil": round(float(row["debito"]), 2),
                "natureza_contabil": "Débito",
                "conta_contabil": row["conta_contabil"],
                "descricao_conta": row["descricao_conta"],
                "aba_origem": row["aba_origem"],
            })
        if abs(row["credito"]) > 0.004:
            rows.append({
                "id_contabil": f"C{idx}-C",
                "data_contabil": row["data"].normalize(),
                "valor_contabil": round(-float(row["credito"]), 2),
                "natureza_contabil": "Crédito",
                "conta_contabil": row["conta_contabil"],
                "descricao_conta": row["descricao_conta"],
                "aba_origem": row["aba_origem"],
            })
    return pd.DataFrame(rows)


def reconcile(bank, accounting_tx, tolerance_days=3, tolerance_value=0.01):
    bank = bank.copy().reset_index(drop=True)
    accounting_tx = accounting_tx.copy().reset_index(drop=True)

    bank["id_banco"] = [f"B{i+1}" for i in range(len(bank))]
    bank["data"] = pd.to_datetime(bank["data"]).dt.normalize()
    bank["valor"] = bank["valor"].round(2)

    if accounting_tx.empty:
        result = bank.copy()
        result["status"] = "Somente no banco"
        result["data_contabil"] = pd.NaT
        result["valor_contabil"] = np.nan
        result["diferenca_dias"] = np.nan
        result["diferenca_valor"] = np.nan
        result["id_contabil"] = ""
        return result, accounting_tx

    used_bank = set()
    used_acc = set()
    matches = []

    # 1) Data e valor exatos
    for bi, b in bank.iterrows():
        candidates = accounting_tx[
            (~accounting_tx.index.isin(used_acc))
            & (accounting_tx["data_contabil"] == b["data"])
            & ((accounting_tx["valor_contabil"] - b["valor"]).abs() <= tolerance_value)
        ]
        if len(candidates):
            ai = candidates.index[0]
            used_bank.add(bi)
            used_acc.add(ai)
            matches.append((bi, ai, "Conciliado", 0))

    # 2) Mesmo valor, com tolerância de dias
    for bi, b in bank.loc[~bank.index.isin(used_bank)].iterrows():
        candidates = accounting_tx[
            (~accounting_tx.index.isin(used_acc))
            & ((accounting_tx["valor_contabil"] - b["valor"]).abs() <= tolerance_value)
        ].copy()
        if len(candidates):
            candidates["dias"] = (candidates["data_contabil"] - b["data"]).abs().dt.days
            candidates = candidates[candidates["dias"] <= tolerance_days].sort_values("dias")
            if len(candidates):
                ai = candidates.index[0]
                days = int(candidates.iloc[0]["dias"])
                used_bank.add(bi)
                used_acc.add(ai)
                matches.append((bi, ai, "Possível conciliação", days))

    rows = []
    for bi, ai, status, days in matches:
        b = bank.loc[bi]
        a = accounting_tx.loc[ai]
        rows.append({
            "status": status,
            "id_banco": b["id_banco"],
            "data_banco": b["data"],
            "historico_banco": b["historico"],
            "valor_banco": b["valor"],
            "id_contabil": a["id_contabil"],
            "data_contabil": a["data_contabil"],
            "natureza_contabil": a["natureza_contabil"],
            "valor_contabil": a["valor_contabil"],
            "diferenca_dias": days,
            "diferenca_valor": round(float(b["valor"] - a["valor_contabil"]), 2),
        })

    for bi, b in bank.loc[~bank.index.isin(used_bank)].iterrows():
        rows.append({
            "status": "Somente no banco",
            "id_banco": b["id_banco"],
            "data_banco": b["data"],
            "historico_banco": b["historico"],
            "valor_banco": b["valor"],
            "id_contabil": "",
            "data_contabil": pd.NaT,
            "natureza_contabil": "",
            "valor_contabil": np.nan,
            "diferenca_dias": np.nan,
            "diferenca_valor": np.nan,
        })

    for ai, a in accounting_tx.loc[~accounting_tx.index.isin(used_acc)].iterrows():
        rows.append({
            "status": "Somente na contabilidade",
            "id_banco": "",
            "data_banco": pd.NaT,
            "historico_banco": "",
            "valor_banco": np.nan,
            "id_contabil": a["id_contabil"],
            "data_contabil": a["data_contabil"],
            "natureza_contabil": a["natureza_contabil"],
            "valor_contabil": a["valor_contabil"],
            "diferenca_dias": np.nan,
            "diferenca_valor": np.nan,
        })

    result = pd.DataFrame(rows)
    order = {
        "Conciliado": 1,
        "Possível conciliação": 2,
        "Somente no banco": 3,
        "Somente na contabilidade": 4,
    }
    result["_ordem"] = result["status"].map(order)
    result = result.sort_values(["_ordem", "data_banco", "data_contabil"]).drop(columns="_ordem")
    return result.reset_index(drop=True), accounting_tx



def build_daily_reconciliation(bank_df, accounting_tx, result, tolerance_value=0.01):
    """Resume banco e contabilidade por dia sem tratar a movimentação como diferença."""
    bank_source = bank_df.copy()
    bank_source["data"] = pd.to_datetime(bank_source["data"]).dt.normalize()
    bank_source["entradas_banco"] = np.where(bank_source["valor"] > 0, bank_source["valor"], 0.0)
    bank_source["saidas_banco"] = np.where(bank_source["valor"] < 0, -bank_source["valor"], 0.0)
    bank_daily = (
        bank_source.groupby("data", as_index=False)
        .agg(
            entradas_banco=("entradas_banco", "sum"),
            saidas_banco=("saidas_banco", "sum"),
            movimento_liquido_banco=("valor", "sum"),
        )
    )

    if accounting_tx.empty:
        acc_daily = pd.DataFrame(
            columns=["data", "debitos_contabeis", "creditos_contabeis", "movimento_liquido_contabil"]
        )
    else:
        acc = accounting_tx.copy()
        acc["data"] = pd.to_datetime(acc["data_contabil"]).dt.normalize()
        acc["debitos_contabeis"] = np.where(acc["valor_contabil"] > 0, acc["valor_contabil"], 0.0)
        acc["creditos_contabeis"] = np.where(acc["valor_contabil"] < 0, -acc["valor_contabil"], 0.0)
        acc_daily = (
            acc.groupby("data", as_index=False)
            .agg(
                debitos_contabeis=("debitos_contabeis", "sum"),
                creditos_contabeis=("creditos_contabeis", "sum"),
                movimento_liquido_contabil=("valor_contabil", "sum"),
            )
        )

    all_dates = pd.concat(
        [
            bank_daily[["data"]] if len(bank_daily) else pd.DataFrame(columns=["data"]),
            acc_daily[["data"]] if len(acc_daily) else pd.DataFrame(columns=["data"]),
        ],
        ignore_index=True,
    ).drop_duplicates()

    daily = all_dates.merge(bank_daily, on="data", how="left").merge(acc_daily, on="data", how="left")
    numeric_cols = [
        "entradas_banco", "saidas_banco", "movimento_liquido_banco",
        "debitos_contabeis", "creditos_contabeis", "movimento_liquido_contabil",
    ]
    for col in numeric_cols:
        daily[col] = daily[col].fillna(0.0).round(2)

    daily["diferenca_do_dia"] = (
        daily["movimento_liquido_banco"] - daily["movimento_liquido_contabil"]
    ).round(2)

    pending_dates = set()
    if len(result):
        pending = result[~result["status"].isin(["Conciliado", "Possível conciliação"])].copy()
        for col in ["data_banco", "data_contabil"]:
            dates = pd.to_datetime(pending[col], errors="coerce").dropna().dt.normalize()
            pending_dates.update(dates.tolist())

    daily["tem_lancamento_pendente"] = daily["data"].isin(pending_dates)
    daily["situacao"] = np.where(
        (daily["diferenca_do_dia"].abs() <= tolerance_value) & (~daily["tem_lancamento_pendente"]),
        "OK",
        "REVISAR",
    )
    return daily.sort_values("data").reset_index(drop=True)

def build_export(results, summary):
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(summary).to_excel(writer, sheet_name="Resumo", index=False)

        all_results = []
        for item in results:
            safe_name = re.sub(r"[\[\]\*\?/\\:]", "", item["nome"])[:25]
            item["resultado"].to_excel(writer, sheet_name=f"Conc_{safe_name}", index=False)
            item["banco"].to_excel(writer, sheet_name=f"Banco_{safe_name}", index=False)
            item["contabilidade"].to_excel(writer, sheet_name=f"Cont_{safe_name}", index=False)
            item["diario"].to_excel(writer, sheet_name=f"Diario_{safe_name}", index=False)

            temp = item["resultado"].copy()
            temp.insert(0, "extrato", item["nome"])
            temp.insert(1, "conta_selecionada", item["conta"])
            all_results.append(temp)

        if all_results:
            todas = pd.concat(all_results, ignore_index=True)
            diferencas = todas[todas["status"] != "Conciliado"].copy()
            diferencas.to_excel(writer, sheet_name="Todas_as_diferencas", index=False)

        workbook = writer.book
        for ws in workbook.worksheets:
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions
            for cell in ws[1]:
                cell.font = cell.font.copy(bold=True)
            for col_cells in ws.columns:
                width = min(max(len(str(c.value)) if c.value is not None else 0 for c in col_cells) + 2, 42)
                ws.column_dimensions[col_cells[0].column_letter].width = max(width, 11)
            for row in ws.iter_rows():
                for cell in row:
                    if "data" in str(ws.cell(1, cell.column).value).lower() and cell.row > 1:
                        cell.number_format = "dd/mm/yyyy"
                    if "valor" in str(ws.cell(1, cell.column).value).lower() and cell.row > 1:
                        cell.number_format = 'R$ #,##0.00;[Red]-R$ #,##0.00'
    output.seek(0)
    return output.getvalue()


st.title("🏦 Conciliação Bancária Automática")
st.caption("Importe a planilha contábil e um ou mais extratos bancários para localizar diferenças do mês.")

with st.sidebar:
    st.header("Regras")
    tolerance_days = st.number_input(
        "Tolerância de dias",
        min_value=0,
        max_value=15,
        value=3,
        help="Usada para sugerir correspondências com o mesmo valor em datas próximas.",
    )
    tolerance_value = st.number_input(
        "Tolerância de valor (R$)",
        min_value=0.00,
        max_value=10.00,
        value=0.01,
        step=0.01,
        format="%.2f",
    )
    st.info(
        "A primeira regra exige data e valor iguais. Depois, o sistema procura o mesmo valor dentro da tolerância de dias. "
        "A soma ou movimentação líquida do mês nunca é classificada como diferença."
    )

st.subheader("Competência")
competence_date = st.date_input(
    "Mês da conciliação",
    value=date.today().replace(day=1),
    help="O sistema armazena extratos e saldos separadamente por competência.",
)
competence = competence_key(competence_date)
balances = load_balances()

stored_now = list_stored_statements(competence)
selected_stored = []
if stored_now:
    with st.expander(f"Extratos já armazenados em {pd.Timestamp(competence_date).strftime('%m/%Y')} ({len(stored_now)})", expanded=False):
        stored_labels = [str(p.relative_to(EXTRATOS_DIR / competence)) for p in stored_now]
        chosen_labels = st.multiselect(
            "Reutilizar extratos armazenados",
            options=stored_labels,
            help="Selecione arquivos já salvos para refazer ou continuar a conciliação.",
        )
        label_map = dict(zip(stored_labels, stored_now))
        selected_stored = [label_map[label] for label in chosen_labels]

accounting_file = st.file_uploader(
    "1. Planilha contábil",
    type=["xlsx", "xlsm"],
    accept_multiple_files=False,
)

uploaded_bank_files = st.file_uploader(
    "2. Extratos bancários — selecione todos os bancos do mês",
    type=["xlsx", "xlsm"],
    accept_multiple_files=True,
    help="Você pode selecionar vários arquivos de uma só vez. Cada extrato será tratado e armazenado separadamente.",
)
store_statements = st.checkbox(
    "Armazenar os novos extratos na ferramenta",
    value=True,
    help="Os arquivos serão copiados para a pasta dados/extratos, organizados por competência e conta.",
)

bank_files = list(uploaded_bank_files or [])
for stored_path in selected_stored:
    stored_buffer = io.BytesIO(stored_path.read_bytes())
    stored_buffer.name = stored_path.name
    stored_buffer._is_stored = True
    bank_files.append(stored_buffer)

if accounting_file:
    try:
        accounting = parse_accounting_file(accounting_file)
        accounts = (
            accounting[["chave_conta", "conta_contabil", "descricao_conta"]]
            .drop_duplicates()
            .sort_values(["descricao_conta", "conta_contabil"])
        )
        st.success(
            f"Planilha contábil carregada: {len(accounting):,} linhas e {len(accounts):,} contas identificadas."
            .replace(",", ".")
        )
    except Exception as exc:
        st.error(f"Erro ao ler a planilha contábil: {exc}")
        st.stop()
else:
    st.info("Envie primeiro a planilha contábil.")
    st.stop()

if not bank_files:
    st.info("Agora envie um ou mais extratos bancários.")
    st.stop()

parsed_banks = []
st.subheader("3. Vincule cada extrato à conta contábil")

for i, bank_file in enumerate(bank_files):
    try:
        bank_df, metadata = parse_bank_file(bank_file)
        parsed_banks.append((bank_file.name, bank_df, metadata, bank_file))
        conta_texto = metadata.get("conta", "")
        default_index = 0

        if conta_texto:
            digits = re.sub(r"\D", "", conta_texto)
            scores = accounts["chave_conta"].map(
                lambda x: sum(1 for part in [digits, digits.lstrip("0")] if part and part in re.sub(r"\D", "", x))
            )
            if scores.max() > 0:
                default_index = int(np.argmax(scores.values))

        with st.expander(f"{bank_file.name} — {len(bank_df)} movimentações", expanded=True):
            c1, c2, c3 = st.columns(3)
            c1.write(f"**Agência:** {metadata.get('agencia') or 'não identificada'}")
            c2.write(f"**Conta:** {metadata.get('conta') or 'não identificada'}")
            c3.write(f"**Período:** {metadata.get('periodo') or 'não identificado'}")

            selected = st.selectbox(
                "Conta contábil correspondente",
                accounts["chave_conta"].tolist(),
                index=default_index,
                key=f"account_{i}_{bank_file.name}",
            )
            st.session_state[f"selected_{i}"] = selected

            inherited = inherited_opening_balance(selected, competence_date, balances)
            opening_key = f"opening_{competence}_{i}_{bank_file.name}"
            if opening_key not in st.session_state:
                st.session_state[opening_key] = inherited

            s1, s2 = st.columns([2, 1])
            saldo_inicial = s1.number_input(
                "Saldo inicial da conta",
                value=float(st.session_state[opening_key]),
                step=0.01,
                format="%.2f",
                key=opening_key,
                help="Pode ser informado manualmente ou herdado do saldo final fixado no mês anterior.",
            )
            fixar = s2.checkbox(
                "Fixar saldo final para o mês seguinte",
                value=False,
                key=f"fix_{competence}_{i}_{bank_file.name}",
            )
            st.session_state[f"saldo_inicial_{i}"] = saldo_inicial
            st.session_state[f"fixar_saldo_{i}"] = fixar
            if inherited and abs(saldo_inicial - inherited) < 0.005:
                st.caption(f"Saldo inicial herdado do mês anterior: {money_br(inherited)}")
    except Exception as exc:
        st.error(f"Erro ao ler {bank_file.name}: {exc}")

run = st.button("▶ Executar conciliação", type="primary", use_container_width=True)

if run:
    results = []
    summary = []

    for i, (name, bank_df, metadata, uploaded_statement) in enumerate(parsed_banks):
        selected_account = st.session_state.get(f"selected_{i}")
        acc_tx = accounting_transactions(accounting, selected_account)
        result, acc_tx = reconcile(
            bank_df,
            acc_tx,
            tolerance_days=int(tolerance_days),
            tolerance_value=float(tolerance_value),
        )
        daily = build_daily_reconciliation(
            bank_df, acc_tx, result, tolerance_value=float(tolerance_value)
        )

        counts = result["status"].value_counts().to_dict()
        somente_banco = result.loc[result["status"] == "Somente no banco", "valor_banco"].abs().sum()
        somente_contabilidade = result.loc[result["status"] == "Somente na contabilidade", "valor_contabil"].abs().sum()
        diferencas_valor = result.loc[result["status"] == "Diferença de valor", "diferenca_valor"].abs().sum() if "Diferença de valor" in result["status"].values else 0.0
        diferenca_conciliacao = round(float(somente_banco + somente_contabilidade + diferencas_valor), 2)

        entradas_banco = round(float(bank_df.loc[bank_df["valor"] > 0, "valor"].sum()), 2)
        saidas_banco = round(float(-bank_df.loc[bank_df["valor"] < 0, "valor"].sum()), 2)
        movimento_liquido = round(float(bank_df["valor"].sum()), 2)
        saldo_inicial = round(float(st.session_state.get(f"saldo_inicial_{i}", 0.0)), 2)
        saldo_final = round(saldo_inicial + movimento_liquido, 2)
        fixar_saldo = bool(st.session_state.get(f"fixar_saldo_{i}", False))

        record_key = balance_record_key(selected_account, competence)
        balances[record_key] = {
            "competencia": competence,
            "conta": selected_account,
            "saldo_inicial": saldo_inicial,
            "movimentacao_liquida": movimento_liquido,
            "saldo_final": saldo_final,
            "fixar_para_mes_seguinte": fixar_saldo,
            "extrato": name,
        }
        if store_statements and not getattr(uploaded_statement, "_is_stored", False):
            store_uploaded_statement(uploaded_statement, competence, selected_account)

        summary.append({
            "Extrato": name,
            "Conta contábil": selected_account,
            "Movimentos banco": len(bank_df),
            "Movimentos contábeis": len(acc_tx),
            "Conciliados": counts.get("Conciliado", 0),
            "Possíveis": counts.get("Possível conciliação", 0),
            "Somente no banco": counts.get("Somente no banco", 0),
            "Somente na contabilidade": counts.get("Somente na contabilidade", 0),
            "Saldo inicial": saldo_inicial,
            "Entradas banco (informativo)": entradas_banco,
            "Saídas banco (informativo)": saidas_banco,
            "Movimentação líquida (informativa)": movimento_liquido,
            "Saldo final": saldo_final,
            "Saldo fixado para próximo mês": "Sim" if fixar_saldo else "Não",
            "Diferença de conciliação": diferenca_conciliacao,
            "Dias para revisar": int((daily["situacao"] == "REVISAR").sum()),
            "Primeiro dia incorreto": (
                daily.loc[daily["situacao"] == "REVISAR", "data"].min()
                if (daily["situacao"] == "REVISAR").any()
                else pd.NaT
            ),
        })
        results.append({
            "nome": Path(name).stem,
            "conta": selected_account,
            "resultado": result,
            "banco": bank_df,
            "contabilidade": acc_tx,
            "diario": daily,
            "metadata": metadata,
            "saldo_inicial": saldo_inicial,
            "saldo_final": saldo_final,
            "fixar_saldo": fixar_saldo,
            "competencia": competence,
        })

    save_balances(balances)
    st.session_state["reconciliation_results"] = results
    st.session_state["reconciliation_summary"] = summary

if "reconciliation_results" in st.session_state:
    results = st.session_state["reconciliation_results"]
    summary = st.session_state["reconciliation_summary"]
    summary_df = pd.DataFrame(summary)

    st.divider()
    st.subheader("Resultado geral")

    totals = summary_df[["Conciliados", "Possíveis", "Somente no banco", "Somente na contabilidade"]].sum()
    m1, m2, m3, m4, m5 = st.columns(5)
    m1.metric("Conciliados", int(totals["Conciliados"]))
    m2.metric("Possíveis", int(totals["Possíveis"]))
    m3.metric("Somente no banco", int(totals["Somente no banco"]))
    m4.metric("Somente na contabilidade", int(totals["Somente na contabilidade"]))
    m5.metric("Diferença de conciliação", money_br(summary_df["Diferença de conciliação"].sum()))

    st.info(
        "A movimentação líquida do mês é apenas informativa e não é tratada como diferença. "
        "A diferença considera somente lançamentos pendentes e divergências de valor."
    )

    display_summary = summary_df.copy()
    money_columns = [
        "Saldo inicial",
        "Entradas banco (informativo)",
        "Saídas banco (informativo)",
        "Movimentação líquida (informativa)",
        "Saldo final",
        "Diferença de conciliação",
    ]
    for column in money_columns:
        display_summary[column] = display_summary[column].map(money_br)
    st.dataframe(display_summary, use_container_width=True, hide_index=True)

    for item in results:
        st.subheader(item["nome"])
        b1, b2, b3 = st.columns(3)
        b1.metric("Saldo inicial", money_br(item["saldo_inicial"]))
        b2.metric("Movimentação líquida", money_br(item["banco"]["valor"].sum()))
        b3.metric("Saldo final", money_br(item["saldo_final"]))
        if item["fixar_saldo"]:
            st.success("Saldo final fixado para ser usado como saldo inicial no mês seguinte.")

        daily = item["diario"]
        days_review = daily[daily["situacao"] == "REVISAR"]
        d1, d2, d3 = st.columns(3)
        d1.metric("Dias com movimento", len(daily))
        d2.metric("Dias para revisar", len(days_review))
        d3.metric(
            "Maior diferença diária",
            money_br(daily["diferenca_do_dia"].abs().max() if len(daily) else 0),
        )

        st.markdown("#### Conferência por dia")
        st.caption(
            "A movimentação do dia é apenas informativa. O dia é marcado para revisão quando "
            "a movimentação líquida do banco não corresponde à contabilidade ou existe lançamento pendente."
        )
        daily_filter = st.radio(
            "Exibir dias",
            ["Somente dias para revisar", "Todos os dias com movimento"],
            horizontal=True,
            key=f"daily_filter_{item['nome']}",
        )
        if daily_filter == "Somente dias para revisar":
            daily_shown = daily[daily["situacao"] == "REVISAR"].copy()
        else:
            daily_shown = daily.copy()

        st.dataframe(
            daily_shown,
            use_container_width=True,
            hide_index=True,
            column_config={
                "data": st.column_config.DateColumn("Data", format="DD/MM/YYYY"),
                "entradas_banco": st.column_config.NumberColumn("Entradas banco", format="R$ %.2f"),
                "saidas_banco": st.column_config.NumberColumn("Saídas banco", format="R$ %.2f"),
                "movimento_liquido_banco": st.column_config.NumberColumn("Mov. líquida banco", format="R$ %.2f"),
                "debitos_contabeis": st.column_config.NumberColumn("Débitos contábeis", format="R$ %.2f"),
                "creditos_contabeis": st.column_config.NumberColumn("Créditos contábeis", format="R$ %.2f"),
                "movimento_liquido_contabil": st.column_config.NumberColumn("Mov. líquida contábil", format="R$ %.2f"),
                "diferenca_do_dia": st.column_config.NumberColumn("Diferença do dia", format="R$ %.2f"),
            },
        )

        st.markdown("#### Conciliação por lançamento")
        result = item["resultado"]
        filter_status = st.multiselect(
            "Filtrar status",
            options=result["status"].unique().tolist(),
            default=result["status"].unique().tolist(),
            key=f"filter_{item['nome']}",
        )
        shown = result[result["status"].isin(filter_status)].copy()
        st.dataframe(
            shown,
            use_container_width=True,
            hide_index=True,
            column_config={
                "data_banco": st.column_config.DateColumn("Data banco", format="DD/MM/YYYY"),
                "data_contabil": st.column_config.DateColumn("Data contábil", format="DD/MM/YYYY"),
                "valor_banco": st.column_config.NumberColumn("Valor banco", format="R$ %.2f"),
                "valor_contabil": st.column_config.NumberColumn("Valor contábil", format="R$ %.2f"),
                "diferenca_valor": st.column_config.NumberColumn("Diferença", format="R$ %.2f"),
            },
        )

    export_data = build_export(results, summary)
    st.download_button(
        "⬇ Baixar relatório completo em Excel",
        data=export_data,
        file_name="resultado_conciliacao_bancaria.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True,
    )
