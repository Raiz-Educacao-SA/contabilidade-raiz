import io
import unittest

import pandas as pd

from Supabase.reconciliation import (
    build_daily_reconciliation,
    build_export,
    reconcile,
)


class ReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.bank = pd.DataFrame(
            {
                "id_banco": [1, 2, 3],
                "data": pd.to_datetime(["2026-07-01", "2026-07-02", "2026-07-04"]),
                "historico": ["Mensalidade", "Tarifa", "Transferência"],
                "valor": [100.0, -10.0, 50.0],
            }
        )
        self.accounting = pd.DataFrame(
            {
                "id_contabil": [1, 2, 3],
                "data_contabil": pd.to_datetime(
                    ["2026-07-01", "2026-07-03", "2026-07-05"]
                ),
                "natureza_contabil": ["D", "C", "D"],
                "valor_contabil": [100.0, -10.0, 70.0],
            }
        )

    def test_exact_suggestion_and_pending_items(self):
        result, _ = reconcile(self.bank, self.accounting, 3, 0.01)
        self.assertEqual(
            result["status"].value_counts().to_dict(),
            {
                "Conciliado": 1,
                "Possível conciliação": 1,
                "Somente no banco": 1,
                "Somente na contabilidade": 1,
            },
        )

    def test_daily_review_ignores_normal_reconciled_movement(self):
        result, accounting = reconcile(self.bank, self.accounting, 3, 0.01)
        daily = build_daily_reconciliation(self.bank, accounting, result, 0.01)
        first_day = daily.loc[daily["data"] == pd.Timestamp("2026-07-01")].iloc[0]
        self.assertEqual(first_day["situacao"], "OK")
        self.assertFalse(bool(first_day["tem_lancamento_pendente"]))

    def test_export_contains_expected_workbook(self):
        result, accounting = reconcile(self.bank, self.accounting, 3, 0.01)
        daily = build_daily_reconciliation(self.bank, accounting, result, 0.01)
        summary = [{"Extrato": "teste.xlsx", "Diferença de conciliação": 120.0}]
        payload = build_export(
            [
                {
                    "nome": "teste",
                    "conta": "1.1.1",
                    "resultado": result,
                    "banco": self.bank,
                    "contabilidade": accounting,
                    "diario": daily,
                }
            ],
            summary,
        )
        workbook = pd.ExcelFile(io.BytesIO(payload))
        self.assertIn("Resumo", workbook.sheet_names)
        self.assertIn("Todas_as_diferencas", workbook.sheet_names)


if __name__ == "__main__":
    unittest.main()
