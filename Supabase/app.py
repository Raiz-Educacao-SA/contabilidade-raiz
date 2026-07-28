import re
import uuid
from datetime import date

import pandas as pd
import streamlit as st
from supabase import create_client
from Supabase.reconciliation_page import render as render_reconciliation

st.set_page_config(page_title="Conciliação Bancária", page_icon="🏦", layout="wide")

def get_supabase():
    try:
        return create_client(
            st.secrets["SUPABASE_URL"],
            st.secrets["SUPABASE_ANON_KEY"],
        )
    except Exception:
        st.error("Configure SUPABASE_URL e SUPABASE_ANON_KEY nos Secrets.")
        st.stop()

supabase = get_supabase()

def require_login():
    if "session" not in st.session_state:
        st.session_state.session = None
    if st.session_state.session is None:
        st.title("🏦 Conciliação Bancária")
        email = st.text_input("E-mail")
        senha = st.text_input("Senha", type="password")
        if st.button("Entrar", type="primary"):
            try:
                result = supabase.auth.sign_in_with_password(
                    {"email": email, "password": senha}
                )
                st.session_state.session = result.session
                st.session_state.user = result.user
                st.rerun()
            except Exception as exc:
                st.error(f"Falha no login: {exc}")
        st.stop()

def user_id():
    return st.session_state.user.id

def list_companies():
    resp = (
        supabase.table("usuarios_empresas")
        .select("empresa_id, perfil, empresas(id, razao_social, cnpj)")
        .eq("usuario_id", user_id())
        .execute()
    )
    rows = []
    for item in resp.data or []:
        emp = item.get("empresas") or {}
        rows.append({
            "empresa_id": item["empresa_id"],
            "razao_social": emp.get("razao_social", ""),
            "perfil": item.get("perfil", "Consulta"),
        })
    return pd.DataFrame(rows)

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

def get_balance(account_id, competencia):
    resp = (
        supabase.table("saldos_bancarios")
        .select("*")
        .eq("conta_bancaria_id", account_id)
        .eq("competencia", competencia)
        .limit(1)
        .execute()
    )
    return (resp.data or [None])[0]

def save_balance(account_id, competencia, inicial, final, fixar):
    payload = {
        "conta_bancaria_id": account_id,
        "competencia": competencia,
        "saldo_inicial": float(inicial),
        "saldo_final": float(final),
        "fixar_mes_seguinte": bool(fixar),
        "usuario_id": user_id(),
    }
    existing = get_balance(account_id, competencia)
    if existing:
        supabase.table("saldos_bancarios").update(payload).eq("id", existing["id"]).execute()
    else:
        supabase.table("saldos_bancarios").insert(payload).execute()

require_login()

with st.sidebar:
    st.title("🏦 Conciliação Bancária")
    st.caption(st.session_state.user.email)
    if st.button("Sair"):
        supabase.auth.sign_out()
        st.session_state.clear()
        st.rerun()

companies = list_companies()
if companies.empty:
    st.warning("Usuário sem empresa vinculada.")
    st.stop()

empresa_nome = st.selectbox("Empresa", companies["razao_social"].tolist())
empresa_id = companies.loc[companies["razao_social"] == empresa_nome, "empresa_id"].iloc[0]

c1, c2 = st.columns(2)
ano = c1.number_input("Ano", 2020, 2100, date.today().year)
mes = c2.number_input("Mês", 1, 12, date.today().month)
competencia = f"{int(ano):04d}-{int(mes):02d}"

accounts = list_accounts(empresa_id)

tab1, tab2, tab3, tab4 = st.tabs(
    ["Extratos", "Contas bancárias", "Saldos", "Conciliação"]
)

with tab2:
    st.subheader("Contas bancárias")
    if len(accounts):
        st.dataframe(accounts, hide_index=True)
    with st.expander("Cadastrar conta"):
        banco = st.text_input("Banco")
        agencia = st.text_input("Agência")
        conta = st.text_input("Conta bancária")
        conta_contabil = st.text_input("Conta contábil")
        descricao = st.text_input("Descrição")
        if st.button("Salvar conta"):
            save_account(empresa_id, banco, agencia, conta, conta_contabil, descricao)
            st.success("Conta cadastrada.")
            st.rerun()

with tab1:
    st.subheader(f"Extratos — {competencia}")
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
            type=["xlsx", "xlsm", "csv", "ofx"],
            accept_multiple_files=True,
        )
        if st.button("Armazenar extratos", type="primary") and files:
            for file in files:
                save_statement(file, empresa_id, conta_id, competencia)
            st.success(f"{len(files)} extrato(s) armazenado(s).")

with tab3:
    st.subheader(f"Saldos — {competencia}")
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
        )
        if st.button("Salvar saldos", type="primary"):
            save_balance(conta_id, competencia, inicial, final, fixar)
            st.success("Saldos salvos.")

with tab4:
    render_reconciliation(
        supabase=supabase,
        company_id=empresa_id,
        competence=competencia,
        accounts=accounts,
        save_statement=save_statement,
        get_balance=get_balance,
        save_balance=save_balance,
    )
