import re
import uuid
from datetime import date

import pandas as pd
import streamlit as st
from supabase import create_client
from Supabase.reconciliation_page import render as render_reconciliation
from Supabase.companies import COMPANIES, COMPANY_CODE_BY_CNPJ

st.set_page_config(page_title="Conciliação Financeira", page_icon=":material/account_balance:", layout="wide")

def get_supabase():
    try:
        url = st.secrets["SUPABASE_URL"]
        anon_key = st.secrets["SUPABASE_ANON_KEY"]
        if not url or not anon_key:
            raise KeyError("Secrets vazios")
        return create_client(
            url,
            anon_key,
        )
    except (KeyError, FileNotFoundError):
        st.error(
            "Configuração incompleta. Cadastre SUPABASE_URL e "
            "SUPABASE_ANON_KEY nos Secrets do Streamlit."
        )
        st.stop()

supabase = get_supabase()

def require_login():
    if "session" not in st.session_state:
        st.session_state.session = None
    if st.session_state.session is None:
        st.space("large")
        st.badge("DATEND · FINANCE OPS", color="violet")
        st.title("Conciliação Financeira", text_alignment="center")
        st.caption(
            "Conferência financeira simples, segura e orientada por dados.",
            text_alignment="center",
        )
        email = st.text_input(
            "E-mail", placeholder="seu.email@empresa.com.br", icon=":material/mail:"
        )
        senha = st.text_input("Senha", type="password", icon=":material/lock:")
        if st.button(
            "Entrar", type="primary", icon=":material/login:", width="stretch"
        ):
            try:
                result = supabase.auth.sign_in_with_password(
                    {"email": email, "password": senha}
                )
                st.session_state.session = result.session
                st.session_state.user = result.user
                st.rerun()
            except Exception:
                st.error(
                    "Não foi possível entrar. Confira o e-mail e a senha.",
                    icon=":material/error:",
                )
        st.stop()

def user_id():
    return st.session_state.user.id

def list_companies():
    resp = (
        supabase.table("usuarios_empresas")
        .select("empresa_id, perfil, empresas(id, codcoligada, razao_social, cnpj)")
        .eq("usuario_id", user_id())
        .execute()
    )
    rows = []
    for item in resp.data or []:
        emp = item.get("empresas") or {}
        rows.append({
            "empresa_id": item["empresa_id"],
            "razao_social": emp.get("razao_social", ""),
            "cnpj": emp.get("cnpj", ""),
            "codigo": emp.get("codcoligada") or COMPANY_CODE_BY_CNPJ.get(emp.get("cnpj", ""), ""),
            "perfil": item.get("perfil", "Consulta"),
        })
    companies = pd.DataFrame(rows)
    if companies.empty:
        return companies
    companies["empresa_label"] = companies.apply(
        lambda row: f"{row['codigo']} — {row['razao_social']}" if row["codigo"] else row["razao_social"],
        axis=1,
    )
    return companies.sort_values(["codigo", "razao_social"]).reset_index(drop=True)

def list_accounts(company_id):
    resp = (
        supabase.table("contas_bancarias")
        .select("*")
        .eq("empresa_id", company_id)
        .eq("ativa", True)
        .execute()
    )
    return pd.DataFrame(resp.data or [])

def save_account(company_id, banco, agencia, conta, conta_contabil, descricao):
    supabase.table("contas_bancarias").insert({
        "empresa_id": company_id,
        "banco": banco,
        "agencia": agencia,
        "conta_bancaria": conta,
        "conta_contabil": conta_contabil,
        "descricao": descricao,
        "ativa": True,
    }).execute()

def save_statement(file, company_id, account_id, competencia):
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", file.name)
    path = f"{company_id}/{competencia}/{account_id}/{uuid.uuid4()}_{safe}"
    supabase.storage.from_("extratos-bancarios").upload(
        path,
        file.getvalue(),
        {"content-type": file.type or "application/octet-stream"},
    )
    supabase.table("arquivos_importados").insert({
        "empresa_id": company_id,
        "competencia": competencia,
        "conta_bancaria_id": account_id,
        "tipo_arquivo": "extrato",
        "caminho_storage": path,
        "nome_original": file.name,
        "usuario_id": user_id(),
    }).execute()

def previous_competence(competencia):
    year, month = (int(part) for part in competencia.split("-"))
    if month == 1:
        return f"{year - 1:04d}-12"
    return f"{year:04d}-{month - 1:02d}"


def get_balance(account_id, competencia, include_carried=True):
    resp = (
        supabase.table("saldos_bancarios")
        .select("*")
        .eq("conta_bancaria_id", account_id)
        .eq("competencia", competencia)
        .limit(1)
        .execute()
    )
    current = (resp.data or [None])[0]
    if current or not include_carried:
        return current

    previous = (
        supabase.table("saldos_bancarios")
        .select("*")
        .eq("conta_bancaria_id", account_id)
        .eq("competencia", previous_competence(competencia))
        .eq("fixar_mes_seguinte", True)
        .limit(1)
        .execute()
    )
    carried = (previous.data or [None])[0]
    if not carried:
        return None
    return {
        "saldo_inicial": carried["saldo_final"],
        "saldo_final": carried["saldo_final"],
        "fixar_mes_seguinte": False,
        "saldo_transportado": True,
    }

def save_balance(account_id, competencia, inicial, final, fixar):
    payload = {
        "conta_bancaria_id": account_id,
        "competencia": competencia,
        "saldo_inicial": float(inicial),
        "saldo_final": float(final),
        "fixar_mes_seguinte": bool(fixar),
        "usuario_id": user_id(),
    }
    existing = get_balance(account_id, competencia, include_carried=False)
    if existing:
        supabase.table("saldos_bancarios").update(payload).eq("id", existing["id"]).execute()
    else:
        supabase.table("saldos_bancarios").insert(payload).execute()

require_login()

with st.sidebar:
    st.badge("DATEND", color="violet")
    st.title("Finance ops")
    st.caption("Conciliação Financeira")
    st.markdown(f":material/account_circle: {st.session_state.user.email}")
    if st.button("Sair", icon=":material/logout:", width="stretch"):
        supabase.auth.sign_out()
        st.session_state.clear()
        st.rerun()

companies = list_companies()
if companies.empty:
    st.warning("Usuário sem empresa vinculada.")
    st.stop()

with st.sidebar:
    st.subheader("Contexto de trabalho")
    empresa_label = st.selectbox("Empresa", companies["empresa_label"].tolist())
    ano = st.number_input("Ano", 2020, 2100, date.today().year)
    mes = st.selectbox(
        "Mês",
        range(1, 13),
        index=date.today().month - 1,
        format_func=lambda value: (
            "Janeiro Fevereiro Março Abril Maio Junho Julho Agosto "
            "Setembro Outubro Novembro Dezembro"
        ).split()[value - 1],
    )

selected_company = companies.loc[companies["empresa_label"] == empresa_label].iloc[0]
empresa_id = selected_company["empresa_id"]
empresa_nome = selected_company["razao_social"]
competencia = f"{int(ano):04d}-{int(mes):02d}"
can_write = str(selected_company["perfil"]).strip().lower() != "consulta"

accounts = list_accounts(empresa_id)

with st.container(border=True):
    st.title("Conciliação Financeira")
    st.caption("Central de conferência de extratos, saldos e lançamentos contábeis.")
    header = st.columns([2.2, 1.4, 1, 1], vertical_alignment="center")
    company_code = selected_company["codigo"]
    header[0].metric("Empresa ativa", f"{company_code} — {empresa_nome}" if company_code else empresa_nome)
    header[1].metric("CNPJ", selected_company["cnpj"] or "Não informado")
    header[2].metric("Competência", f"{int(mes):02d}/{int(ano)}")
    header[3].metric("Contas ativas", len(accounts))

tab1, tab_companies, tab2, tab3, tab4 = st.tabs(
    [
        ":material/compare_arrows: Conciliação",
        ":material/domain: Empresas",
        ":material/account_balance: Contas",
        ":material/upload_file: Extratos",
        ":material/payments: Saldos",
    ]
)

with tab_companies:
    st.subheader("Empresas")
    st.caption("Cadastro mestre do grupo. O acesso operacional respeita os vínculos do seu usuário.")
    master_companies = pd.DataFrame(COMPANIES).rename(columns={
        "codigo": "Código", "razao_social": "Razão social", "cnpj": "CNPJ"
    })
    authorized_cnpjs = set(companies["cnpj"].dropna())
    master_companies["Acesso"] = master_companies["CNPJ"].map(
        lambda cnpj: "Disponível" if cnpj in authorized_cnpjs else "Não vinculado"
    )
    metrics = st.columns(3)
    metrics[0].metric("Empresas cadastradas", len(master_companies))
    metrics[1].metric("Disponíveis para você", len(companies))
    metrics[2].metric("Perfil atual", selected_company["perfil"])
    st.dataframe(master_companies, hide_index=True, width="stretch")

with tab2:
    st.subheader("Contas bancárias")
    if len(accounts):
        st.dataframe(accounts.drop(columns=["id", "empresa_id", "ativa"], errors="ignore"), hide_index=True, width="stretch")
    if not can_write:
        st.info("Seu perfil permite somente consultar as contas cadastradas.")
    with st.expander("Cadastrar nova conta", icon=":material/add_circle:"):
        banco = st.text_input("Banco")
        agencia = st.text_input("Agência")
        conta = st.text_input("Conta bancária")
        conta_contabil = st.text_input("Conta contábil")
        descricao = st.text_input("Descrição")
        if st.button("Salvar conta", disabled=not can_write):
            if not banco.strip() or not conta.strip():
                st.error("Informe pelo menos o banco e a conta bancária.")
                st.stop()
            save_account(empresa_id, banco, agencia, conta, conta_contabil, descricao)
            st.success("Conta cadastrada.")
            st.rerun()

with tab3:
    st.subheader("Importar extratos")
    if accounts.empty:
        st.info("Cadastre uma conta bancária primeiro.")
    else:
        labels = {
            f"{r['banco']} | Ag. {r['agencia']} | Cc. {r['conta_bancaria']}": r["id"]
            for _, r in accounts.iterrows()
        }
        label = st.selectbox("Conta do extrato", list(labels.keys()))
        conta_id = labels[label]
        files = st.file_uploader(
            "Selecione um ou mais extratos",
            type=["xlsx", "xlsm"],
            accept_multiple_files=True,
            disabled=not can_write,
        )
        if not can_write:
            st.info("Seu perfil não permite armazenar novos extratos.")
        if st.button("Armazenar extratos", type="primary", disabled=not can_write) and files:
            for file in files:
                save_statement(file, empresa_id, conta_id, competencia)
            st.success(f"{len(files)} extrato(s) armazenado(s).")

with tab4:
    st.subheader("Saldos bancários")
    if accounts.empty:
        st.info("Cadastre uma conta bancária primeiro.")
    else:
        labels = {
            f"{r['banco']} | Ag. {r['agencia']} | Cc. {r['conta_bancaria']}": r["id"]
            for _, r in accounts.iterrows()
        }
        label = st.selectbox("Conta bancária", list(labels.keys()), key="saldo_conta")
        conta_id = labels[label]
        existing = get_balance(conta_id, competencia)
        inicial = st.number_input(
            "Saldo inicial",
            value=float(existing["saldo_inicial"]) if existing else 0.0,
            step=0.01,
            format="%.2f",
        )
        final = st.number_input(
            "Saldo final",
            value=float(existing["saldo_final"]) if existing else inicial,
            step=0.01,
            format="%.2f",
        )
        fixar = st.checkbox(
            "Fixar saldo final como saldo inicial do mês seguinte",
            value=bool(existing["fixar_mes_seguinte"]) if existing else False,
            disabled=not can_write,
        )
        if not can_write:
            st.info("Seu perfil permite somente consultar os saldos.")
        if st.button("Salvar saldos", type="primary", disabled=not can_write):
            save_balance(conta_id, competencia, inicial, final, fixar)
            st.success("Saldos salvos.")

with tab1:
    render_reconciliation(
        supabase=supabase,
        company_id=empresa_id,
        competence=competencia,
        accounts=accounts,
        save_statement=save_statement,
        get_balance=get_balance,
        save_balance=save_balance,
        can_write=can_write,
    )
