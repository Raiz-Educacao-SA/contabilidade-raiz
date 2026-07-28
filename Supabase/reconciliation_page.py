"""Interface da conciliação online."""

from __future__ import annotations

import io
from pathlib import Path

import pandas as pd
import streamlit as st

from Supabase.reconciliation import (
    accounting_transactions,
    build_daily_reconciliation,
    build_export,
    find_account_key,
    money_br,
    parse_accounting_file,
    parse_bank_file,
    reconcile,
)


def _stored_statements(supabase, company_id, competence):
    response = (
        supabase.table("arquivos_importados")
        .select("id, conta_bancaria_id, caminho_storage, nome_original, created_at")
        .eq("empresa_id", company_id)
        .eq("competencia", competence)
        .eq("tipo_arquivo", "extrato")
        .order("created_at", desc=True)
        .execute()
    )
    return response.data or []


def _download(supabase, statement):
    content = supabase.storage.from_("extratos-bancarios").download(statement["caminho_storage"])
    buffer = io.BytesIO(content)
    buffer.name = statement["nome_original"]
    return buffer


def _account_label(row):
    return (
        f"{row.get('banco', '')} | Ag. {row.get('agencia', '')} | "
        f"Cc. {row.get('conta_bancaria', '')} | Contábil {row.get('conta_contabil', '')}"
    )


def _result_metrics(results, summary):
    summary_frame = pd.DataFrame(summary)
    totals = summary_frame[
        ["Conciliados", "Possíveis", "Somente no banco", "Somente na contabilidade"]
    ].sum()
    columns = st.columns(5)
    columns[0].metric("Conciliados", int(totals["Conciliados"]))
    columns[1].metric("Possíveis", int(totals["Possíveis"]))
    columns[2].metric("Somente no banco", int(totals["Somente no banco"]))
    columns[3].metric("Somente na contabilidade", int(totals["Somente na contabilidade"]))
    columns[4].metric(
        "Diferença de conciliação",
        money_br(summary_frame["Diferença de conciliação"].sum()),
    )

    st.dataframe(
        summary_frame,
        hide_index=True,
        column_config={
            column: st.column_config.NumberColumn(column, format="R$ %.2f")
            for column in (
                "Saldo inicial",
                "Entradas banco",
                "Saídas banco",
                "Movimentação líquida",
                "Saldo final",
                "Diferença de conciliação",
            )
        },
    )

    for index, item in enumerate(results):
        with st.expander(item["nome"], expanded=True):
            balances = st.columns(3)
            balances[0].metric("Saldo inicial", money_br(item["saldo_inicial"]))
            balances[1].metric("Movimentação líquida", money_br(item["banco"]["valor"].sum()))
            balances[2].metric("Saldo final", money_br(item["saldo_final"]))

            st.markdown("#### Conferência diária")
            daily = item["diario"]
            display_mode = st.segmented_control(
                "Exibir dias",
                ["Para revisar", "Todos"],
                default="Para revisar",
                key=f"online_daily_mode_{index}_{item['nome']}",
            )
            shown_daily = daily[daily["situacao"] == "REVISAR"] if display_mode == "Para revisar" else daily
            st.dataframe(
                shown_daily,
                hide_index=True,
                column_config={
                    "data": st.column_config.DateColumn("Data", format="DD/MM/YYYY"),
                    "entradas_banco": st.column_config.NumberColumn("Entradas banco", format="R$ %.2f"),
                    "saidas_banco": st.column_config.NumberColumn("Saídas banco", format="R$ %.2f"),
                    "movimento_liquido_banco": st.column_config.NumberColumn("Mov. banco", format="R$ %.2f"),
                    "movimento_liquido_contabil": st.column_config.NumberColumn("Mov. contábil", format="R$ %.2f"),
                    "diferenca_do_dia": st.column_config.NumberColumn("Diferença", format="R$ %.2f"),
                },
            )

            st.markdown("#### Conciliação por lançamento")
            statuses = item["resultado"]["status"].drop_duplicates().tolist()
            selected_statuses = st.pills(
                "Status",
                statuses,
                default=statuses,
                selection_mode="multi",
                key=f"online_status_{index}_{item['nome']}",
            )
            shown = item["resultado"][item["resultado"]["status"].isin(selected_statuses or [])]
            st.dataframe(
                shown,
                hide_index=True,
                column_config={
                    "data_banco": st.column_config.DateColumn("Data banco", format="DD/MM/YYYY"),
                    "data_contabil": st.column_config.DateColumn("Data contábil", format="DD/MM/YYYY"),
                    "valor_banco": st.column_config.NumberColumn("Valor banco", format="R$ %.2f"),
                    "valor_contabil": st.column_config.NumberColumn("Valor contábil", format="R$ %.2f"),
                    "diferenca_valor": st.column_config.NumberColumn("Diferença", format="R$ %.2f"),
                },
            )

    report = build_export(results, summary)
    st.download_button(
        "Baixar relatório completo",
        data=report,
        file_name=f"conciliacao_{results[0]['competencia']}.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        icon=":material/download:",
        width="stretch",
    )


def render(
    supabase,
    company_id,
    competence,
    accounts,
    save_statement,
    get_balance,
    save_balance,
):
    st.subheader(f"Conciliação — {competence}")
    if accounts.empty:
        st.info("Cadastre uma conta bancária antes de iniciar.")
        return

    rules = st.container(horizontal=True)
    tolerance_days = rules.number_input("Tolerância de dias", 0, 15, 3)
    tolerance_value = rules.number_input(
        "Tolerância de valor (R$)", 0.0, 10.0, 0.01, step=0.01, format="%.2f"
    )

    accounting_file = st.file_uploader(
        "Planilha contábil",
        type=["xlsx", "xlsm"],
        key=f"online_accounting_{company_id}_{competence}",
    )
    uploaded = st.file_uploader(
        "Novos extratos bancários",
        type=["xlsx", "xlsm"],
        accept_multiple_files=True,
        key=f"online_statements_{company_id}_{competence}",
    )

    stored = _stored_statements(supabase, company_id, competence)
    stored_by_label = {
        f"{item['nome_original']} — {str(item.get('created_at', ''))[:16]}": item for item in stored
    }
    selected_stored = st.multiselect(
        "Reutilizar extratos armazenados nesta competência",
        list(stored_by_label),
        key=f"online_stored_{company_id}_{competence}",
    )

    if accounting_file is None:
        st.info("Envie a planilha contábil para identificar as contas.")
        return
    try:
        accounting = parse_accounting_file(accounting_file)
    except Exception as exception:
        st.error(f"Erro ao ler a planilha contábil: {exception}")
        return

    bank_files = list(uploaded or [])
    stored_account_ids = {}
    for label in selected_stored:
        statement = stored_by_label[label]
        try:
            downloaded = _download(supabase, statement)
            stored_account_ids[id(downloaded)] = statement["conta_bancaria_id"]
            bank_files.append(downloaded)
        except Exception as exception:
            st.error(f"Não foi possível baixar {statement['nome_original']}: {exception}")

    if not bank_files:
        st.info("Envie um extrato novo ou selecione um extrato armazenado.")
        return

    account_records = accounts.to_dict("records")
    account_labels = {_account_label(row): row for row in account_records}
    parsed = []
    st.markdown("#### Vincule os extratos")
    for index, file in enumerate(bank_files):
        try:
            bank, metadata = parse_bank_file(file)
        except Exception as exception:
            st.error(f"Erro ao ler {file.name}: {exception}")
            continue
        stored_account_id = stored_account_ids.get(id(file))
        default_index = next(
            (
                position
                for position, row in enumerate(account_records)
                if stored_account_id and row["id"] == stored_account_id
            ),
            0,
        )
        with st.container(border=True):
            st.write(f"**{file.name}** — {len(bank)} movimentações")
            label = st.selectbox(
                "Conta bancária e contábil",
                list(account_labels),
                index=default_index,
                key=f"online_account_link_{index}_{file.name}_{competence}",
            )
            account = account_labels[label]
            existing_balance = get_balance(account["id"], competence)
            initial_balance = st.number_input(
                "Saldo inicial",
                value=float(existing_balance["saldo_inicial"]) if existing_balance else 0.0,
                step=0.01,
                format="%.2f",
                key=f"online_initial_{index}_{file.name}_{competence}",
            )
            carry = st.checkbox(
                "Fixar saldo final para o mês seguinte",
                value=bool(existing_balance["fixar_mes_seguinte"]) if existing_balance else False,
                key=f"online_carry_{index}_{file.name}_{competence}",
            )
        parsed.append((file, bank, metadata, account, initial_balance, carry, stored_account_id is not None))

    if not parsed:
        return
    if not st.button(
        "Executar conciliação",
        type="primary",
        icon=":material/compare_arrows:",
        width="stretch",
        key=f"online_run_{company_id}_{competence}",
    ):
        if st.session_state.get("online_reconciliation_company") == company_id:
            _result_metrics(
                st.session_state["online_reconciliation_results"],
                st.session_state["online_reconciliation_summary"],
            )
        return

    results, summary = [], []
    with st.spinner("Conciliando lançamentos..."):
        for file, bank, metadata, account, initial_balance, carry, is_stored in parsed:
            account_key = find_account_key(accounting, account.get("conta_contabil"))
            if account_key is None:
                st.error(
                    f"A conta contábil {account.get('conta_contabil')} de {file.name} "
                    "não foi localizada na planilha contábil."
                )
                continue
            accounting_rows = accounting_transactions(accounting, account_key)
            result, accounting_rows = reconcile(
                bank, accounting_rows, int(tolerance_days), float(tolerance_value)
            )
            daily = build_daily_reconciliation(bank, accounting_rows, result, float(tolerance_value))
            net = round(float(bank["valor"].sum()), 2)
            final_balance = round(float(initial_balance) + net, 2)
            save_balance(account["id"], competence, initial_balance, final_balance, carry)
            if not is_stored:
                save_statement(file, company_id, account["id"], competence)

            counts = result["status"].value_counts().to_dict()
            bank_only = result.loc[result["status"] == "Somente no banco", "valor_banco"].abs().sum()
            accounting_only = result.loc[
                result["status"] == "Somente na contabilidade", "valor_contabil"
            ].abs().sum()
            difference = round(float(bank_only + accounting_only), 2)
            summary.append(
                {
                    "Extrato": file.name,
                    "Conta contábil": account_key,
                    "Conciliados": counts.get("Conciliado", 0),
                    "Possíveis": counts.get("Possível conciliação", 0),
                    "Somente no banco": counts.get("Somente no banco", 0),
                    "Somente na contabilidade": counts.get("Somente na contabilidade", 0),
                    "Saldo inicial": float(initial_balance),
                    "Entradas banco": float(bank.loc[bank["valor"] > 0, "valor"].sum()),
                    "Saídas banco": float(-bank.loc[bank["valor"] < 0, "valor"].sum()),
                    "Movimentação líquida": net,
                    "Saldo final": final_balance,
                    "Diferença de conciliação": difference,
                    "Dias para revisar": int((daily["situacao"] == "REVISAR").sum()),
                }
            )
            results.append(
                {
                    "nome": Path(file.name).stem,
                    "conta": account_key,
                    "resultado": result,
                    "banco": bank,
                    "contabilidade": accounting_rows,
                    "diario": daily,
                    "metadata": metadata,
                    "saldo_inicial": float(initial_balance),
                    "saldo_final": final_balance,
                    "competencia": competence,
                }
            )

    if not results:
        return
    st.session_state["online_reconciliation_company"] = company_id
    st.session_state["online_reconciliation_results"] = results
    st.session_state["online_reconciliation_summary"] = summary
    st.success("Conciliação concluída e extratos/saldos atualizados no Supabase.")
    _result_metrics(results, summary)
