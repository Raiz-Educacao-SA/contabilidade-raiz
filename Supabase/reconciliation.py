"""Regras de leitura, conciliação e exportação, sem dependência do Streamlit."""

from __future__ import annotations

import io
import re
from copy import copy
import unicodedata

import numpy as np
import pandas as pd


def normalize_text(value) -> str:
    if pd.isna(value):
        return ""
    text = unicodedata.normalize("NFKD", str(value).strip().upper())
    return "".join(char for char in text if not unicodedata.combining(char))


def money_br(value) -> str:
    try:
        return f"R$ {float(value):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    except (TypeError, ValueError):
        return "R$ 0,00"


def _read_raw(file, sheet_name=0):
    file.seek(0)
    return pd.read_excel(file, sheet_name=sheet_name, header=None, engine="openpyxl")


def _sheet_names(file):
    file.seek(0)
    return pd.ExcelFile(file, engine="openpyxl").sheet_names


def _header_row(frame, terms):
    best_row, best_score = None, 0
    for index in range(min(len(frame), 40)):
        joined = " | ".join(normalize_text(value) for value in frame.iloc[index].tolist())
        score = sum(term in joined for term in terms)
        if score > best_score:
            best_row, best_score = index, score
    return best_row if best_score >= 2 else None


def parse_accounting_file(file):
    candidates = []
    for sheet in _sheet_names(file):
        raw = _read_raw(file, sheet)
        header_row = _header_row(raw, ["DESCRICAO", "CODCONTA", "DATA", "DEBITO", "CREDITO"])
        if header_row is None:
            continue

        headers = [normalize_text(value) or f"COL_{index}" for index, value in enumerate(raw.iloc[header_row])]
        frame = raw.iloc[header_row + 1 :].copy()
        frame.columns = headers
        frame = frame.dropna(how="all")
        columns = {}
        for column in frame.columns:
            name = normalize_text(column)
            if "DESCRICAO" in name:
                columns.setdefault("descricao", column)
            if name == "CODCONTA" or "CODCONTA" in name or "CONTA CONTABIL" in name:
                columns.setdefault("conta", column)
            if "DATACOMPENSACAO" in name or name in {"DATA", "DATA COMPENSACAO"}:
                columns.setdefault("data", column)
            if name == "DEBITO":
                columns.setdefault("debito", column)
            if name == "CREDITO":
                columns.setdefault("credito", column)
            if name == "CODCOLPROP" or "COLIGADA" in name:
                columns.setdefault("coligada", column)

        if not {"descricao", "conta", "data", "debito", "credito"}.issubset(columns):
            continue

        parsed = pd.DataFrame(
            {
                "coligada": frame[columns["coligada"]] if "coligada" in columns else "",
                "conta_contabil": frame[columns["conta"]].astype(str).str.strip(),
                "descricao_conta": frame[columns["descricao"]].astype(str).str.strip(),
                "data": pd.to_datetime(frame[columns["data"]], errors="coerce", dayfirst=True),
                "debito": pd.to_numeric(frame[columns["debito"]], errors="coerce").fillna(0.0),
                "credito": pd.to_numeric(frame[columns["credito"]], errors="coerce").fillna(0.0),
                "aba_origem": sheet,
            }
        )
        parsed = parsed[parsed["data"].notna()]
        parsed = parsed[(parsed["debito"].abs() > 0.004) | (parsed["credito"].abs() > 0.004)]
        candidates.append(parsed)

    if not candidates:
        raise ValueError("Não encontrei as colunas de conta, descrição, data, débito e crédito.")

    accounting = pd.concat(candidates, ignore_index=True)
    accounting["chave_conta"] = accounting["conta_contabil"] + " — " + accounting["descricao_conta"]
    return accounting


def _metadata(raw):
    metadata = {"agencia": "", "conta": "", "periodo": "", "nome": ""}
    for index in range(min(len(raw), 15)):
        row = ["" if pd.isna(value) else str(value).strip() for value in raw.iloc[index]]
        label, value = normalize_text(row[0]), row[1] if len(row) > 1 else ""
        for field, prefix in (("agencia", "AGENCIA"), ("conta", "CONTA"), ("periodo", "PERIODO"), ("nome", "NOME")):
            if label.startswith(prefix):
                metadata[field] = value
    return metadata


def parse_bank_file(file):
    for sheet in _sheet_names(file):
        raw = _read_raw(file, sheet)
        header_row = _header_row(raw, ["DATA", "LANCAMENTO", "VALOR"])
        if header_row is None:
            continue
        headers = [normalize_text(value) or f"COL_{index}" for index, value in enumerate(raw.iloc[header_row])]
        frame = raw.iloc[header_row + 1 :].copy()
        frame.columns = headers
        frame = frame.dropna(how="all")
        date_column = next((column for column in frame if normalize_text(column) == "DATA"), None)
        description_column = next(
            (column for column in frame if any(term in normalize_text(column) for term in ("LANCAMENTO", "HISTORICO", "DESCRICAO"))),
            None,
        )
        value_column = next(
            (column for column in frame if "VALOR" in normalize_text(column) and "SALDO" not in normalize_text(column)),
            None,
        )
        if not all((date_column, description_column, value_column)):
            continue
        parsed = pd.DataFrame(
            {
                "data": pd.to_datetime(frame[date_column], errors="coerce", dayfirst=True),
                "historico": frame[description_column].astype(str).str.strip(),
                "valor": pd.to_numeric(frame[value_column], errors="coerce"),
                "arquivo_extrato": getattr(file, "name", "extrato.xlsx"),
                "aba_origem": sheet,
            }
        )
        parsed = parsed[parsed["data"].notna() & parsed["valor"].notna()]
        normalized = parsed["historico"].map(normalize_text)
        ignored = ("SALDO ANTERIOR", "SALDO TOTAL", "SALDO DISPONIVEL", "SALDO DO DIA")
        parsed = parsed[~normalized.apply(lambda text: any(term in text for term in ignored))]
        parsed = parsed[parsed["valor"].abs() > 0.004]
        if not parsed.empty:
            return parsed.reset_index(drop=True), _metadata(raw)
    raise ValueError("Não consegui identificar Data, Lançamento/Histórico e Valor no extrato.")


def find_account_key(accounting, account_code):
    code = re.sub(r"\D", "", str(account_code))
    if not code:
        return None
    keys = accounting["chave_conta"].drop_duplicates()
    exact = keys[accounting.loc[keys.index, "conta_contabil"].astype(str) == str(account_code)]
    if len(exact):
        return exact.iloc[0]
    matches = keys[keys.map(lambda value: code in re.sub(r"\D", "", value))]
    return matches.iloc[0] if len(matches) else None


def accounting_transactions(accounting, selected_account):
    selected = accounting[accounting["chave_conta"] == selected_account]
    rows = []
    for index, row in selected.iterrows():
        if abs(row["debito"]) > 0.004:
            rows.append(
                {
                    "id_contabil": f"C{index}-D",
                    "data_contabil": row["data"].normalize(),
                    "valor_contabil": round(float(row["debito"]), 2),
                    "natureza_contabil": "Débito",
                    "conta_contabil": row["conta_contabil"],
                    "descricao_conta": row["descricao_conta"],
                    "aba_origem": row["aba_origem"],
                }
            )
        if abs(row["credito"]) > 0.004:
            rows.append(
                {
                    "id_contabil": f"C{index}-C",
                    "data_contabil": row["data"].normalize(),
                    "valor_contabil": round(-float(row["credito"]), 2),
                    "natureza_contabil": "Crédito",
                    "conta_contabil": row["conta_contabil"],
                    "descricao_conta": row["descricao_conta"],
                    "aba_origem": row["aba_origem"],
                }
            )
    return pd.DataFrame(rows)


def reconcile(bank, accounting, tolerance_days=3, tolerance_value=0.01):
    bank, accounting = bank.copy().reset_index(drop=True), accounting.copy().reset_index(drop=True)
    bank["id_banco"] = [f"B{index + 1}" for index in range(len(bank))]
    bank["data"] = pd.to_datetime(bank["data"]).dt.normalize()
    bank["valor"] = bank["valor"].round(2)
    used_bank, used_accounting, matches = set(), set(), []

    for bank_index, bank_row in bank.iterrows():
        candidates = accounting[
            (~accounting.index.isin(used_accounting))
            & (accounting["data_contabil"] == bank_row["data"])
            & ((accounting["valor_contabil"] - bank_row["valor"]).abs() <= tolerance_value)
        ]
        if len(candidates):
            accounting_index = candidates.index[0]
            used_bank.add(bank_index)
            used_accounting.add(accounting_index)
            matches.append((bank_index, accounting_index, "Conciliado", 0))

    for bank_index, bank_row in bank.loc[~bank.index.isin(used_bank)].iterrows():
        candidates = accounting[
            (~accounting.index.isin(used_accounting))
            & ((accounting["valor_contabil"] - bank_row["valor"]).abs() <= tolerance_value)
        ].copy()
        if len(candidates):
            candidates["dias"] = (candidates["data_contabil"] - bank_row["data"]).abs().dt.days
            candidates = candidates[candidates["dias"] <= tolerance_days].sort_values("dias")
            if len(candidates):
                accounting_index = candidates.index[0]
                used_bank.add(bank_index)
                used_accounting.add(accounting_index)
                matches.append((bank_index, accounting_index, "Possível conciliação", int(candidates.iloc[0]["dias"])))

    rows = []
    for bank_index, accounting_index, status, days in matches:
        bank_row, accounting_row = bank.loc[bank_index], accounting.loc[accounting_index]
        rows.append(
            {
                "status": status,
                "id_banco": bank_row["id_banco"],
                "data_banco": bank_row["data"],
                "historico_banco": bank_row["historico"],
                "valor_banco": bank_row["valor"],
                "id_contabil": accounting_row["id_contabil"],
                "data_contabil": accounting_row["data_contabil"],
                "natureza_contabil": accounting_row["natureza_contabil"],
                "valor_contabil": accounting_row["valor_contabil"],
                "diferenca_dias": days,
                "diferenca_valor": round(float(bank_row["valor"] - accounting_row["valor_contabil"]), 2),
            }
        )
    for _, row in bank.loc[~bank.index.isin(used_bank)].iterrows():
        rows.append(
            {
                "status": "Somente no banco", "id_banco": row["id_banco"],
                "data_banco": row["data"], "historico_banco": row["historico"],
                "valor_banco": row["valor"], "id_contabil": "", "data_contabil": pd.NaT,
                "natureza_contabil": "", "valor_contabil": np.nan,
                "diferenca_dias": np.nan, "diferenca_valor": np.nan,
            }
        )
    for _, row in accounting.loc[~accounting.index.isin(used_accounting)].iterrows():
        rows.append(
            {
                "status": "Somente na contabilidade", "id_banco": "", "data_banco": pd.NaT,
                "historico_banco": "", "valor_banco": np.nan, "id_contabil": row["id_contabil"],
                "data_contabil": row["data_contabil"], "natureza_contabil": row["natureza_contabil"],
                "valor_contabil": row["valor_contabil"], "diferenca_dias": np.nan,
                "diferenca_valor": np.nan,
            }
        )
    columns = [
        "status", "id_banco", "data_banco", "historico_banco", "valor_banco",
        "id_contabil", "data_contabil", "natureza_contabil", "valor_contabil",
        "diferenca_dias", "diferenca_valor",
    ]
    result = pd.DataFrame(rows, columns=columns)
    order = {"Conciliado": 1, "Possível conciliação": 2, "Somente no banco": 3, "Somente na contabilidade": 4}
    if not result.empty:
        result["_ordem"] = result["status"].map(order)
        result = result.sort_values(["_ordem", "data_banco", "data_contabil"]).drop(columns="_ordem")
    return result.reset_index(drop=True), accounting


def build_daily_reconciliation(bank, accounting, result, tolerance_value=0.01):
    bank_source = bank.copy()
    bank_source["data"] = pd.to_datetime(bank_source["data"]).dt.normalize()
    bank_source["entradas_banco"] = bank_source["valor"].clip(lower=0)
    bank_source["saidas_banco"] = -bank_source["valor"].clip(upper=0)
    bank_daily = bank_source.groupby("data", as_index=False).agg(
        entradas_banco=("entradas_banco", "sum"), saidas_banco=("saidas_banco", "sum"),
        movimento_liquido_banco=("valor", "sum"),
    )
    if accounting.empty:
        accounting_daily = pd.DataFrame(columns=["data", "debitos_contabeis", "creditos_contabeis", "movimento_liquido_contabil"])
    else:
        source = accounting.copy()
        source["data"] = pd.to_datetime(source["data_contabil"]).dt.normalize()
        source["debitos_contabeis"] = source["valor_contabil"].clip(lower=0)
        source["creditos_contabeis"] = -source["valor_contabil"].clip(upper=0)
        accounting_daily = source.groupby("data", as_index=False).agg(
            debitos_contabeis=("debitos_contabeis", "sum"), creditos_contabeis=("creditos_contabeis", "sum"),
            movimento_liquido_contabil=("valor_contabil", "sum"),
        )
    dates = pd.concat([bank_daily[["data"]], accounting_daily[["data"]]]).drop_duplicates()
    daily = dates.merge(bank_daily, how="left").merge(accounting_daily, how="left").fillna(0)
    daily["diferenca_do_dia"] = (daily["movimento_liquido_banco"] - daily["movimento_liquido_contabil"]).round(2)
    pending_dates = set()
    pending = result[~result["status"].isin(["Conciliado", "Possível conciliação"])]
    for column in ("data_banco", "data_contabil"):
        pending_dates.update(pd.to_datetime(pending[column], errors="coerce").dropna().dt.normalize())
    daily["tem_lancamento_pendente"] = daily["data"].isin(pending_dates)
    daily["situacao"] = np.where(
        (daily["diferenca_do_dia"].abs() <= tolerance_value) & ~daily["tem_lancamento_pendente"], "OK", "REVISAR"
    )
    return daily.sort_values("data").reset_index(drop=True)


def build_export(results, summary):
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(summary).to_excel(writer, sheet_name="Resumo", index=False)
        combined = []
        for item in results:
            name = re.sub(r"[\[\]*?/\\:]", "", item["nome"])[:25]
            item["resultado"].to_excel(writer, sheet_name=f"Conc_{name}", index=False)
            item["banco"].to_excel(writer, sheet_name=f"Banco_{name}", index=False)
            item["contabilidade"].to_excel(writer, sheet_name=f"Cont_{name}", index=False)
            item["diario"].to_excel(writer, sheet_name=f"Diario_{name}", index=False)
            temporary = item["resultado"].copy()
            temporary.insert(0, "extrato", item["nome"])
            temporary.insert(1, "conta_selecionada", item["conta"])
            combined.append(temporary)
        if combined:
            all_results = pd.concat(combined, ignore_index=True)
            all_results[all_results["status"] != "Conciliado"].to_excel(
                writer, sheet_name="Todas_as_diferencas", index=False
            )
        for worksheet in writer.book.worksheets:
            worksheet.freeze_panes = "A2"
            worksheet.auto_filter.ref = worksheet.dimensions
            for cell in worksheet[1]:
                font = copy(cell.font)
                font.bold = True
                cell.font = font
            for cells in worksheet.columns:
                width = min(max(len(str(cell.value or "")) for cell in cells) + 2, 42)
                worksheet.column_dimensions[cells[0].column_letter].width = max(width, 11)
    return output.getvalue()
