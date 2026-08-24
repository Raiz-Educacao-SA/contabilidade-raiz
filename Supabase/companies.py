"""Cadastro mestre de empresas fornecido em Resumo_Empresas.xlsx."""

COMPANIES = [
    {"codigo": "01", "razao_social": "RAIZ EDUCAÇÃO", "cnpj": "21.219.576/0001-14"},
    {"codigo": "02", "razao_social": "COLÉGIO QI", "cnpj": "86.704.160/0001-37"},
    {"codigo": "03", "razao_social": "RAIZ SUL", "cnpj": "21.669.216/0001-14"},
    {"codigo": "04", "razao_social": "EDITORA RAIZ", "cnpj": "14.642.152/0001-00"},
    {"codigo": "05", "razao_social": "AO CUBO", "cnpj": "23.075.186/0001-43"},
    {"codigo": "06", "razao_social": "METROPOLITANO", "cnpj": "33.590.308/0001-93"},
    {"codigo": "08", "razao_social": "MATRIZ EDUCAÇÃO", "cnpj": "28.336.302/0001-54"},
    {"codigo": "09", "razao_social": "Global Tree", "cnpj": "28.734.505/0001-07"},
    {"codigo": "10", "razao_social": "ESCOLAS INTEGRADAS", "cnpj": "07.499.961/0001-31"},
    {"codigo": "11", "razao_social": "GEU", "cnpj": "89.409.825/0001-78"},
    {"codigo": "12", "razao_social": "CLV", "cnpj": "09.262.835/0001-94"},
    {"codigo": "13", "razao_social": "SELVI", "cnpj": "92.845.437/0001-44"},
    {"codigo": "14", "razao_social": "DIDACTA", "cnpj": "87.188.959/0001-80"},
    {"codigo": "16", "razao_social": "CLV GAMA", "cnpj": "38.376.734/0001-42"},
    {"codigo": "17", "razao_social": "BOM TEMPO", "cnpj": "20.647.702/0001-79"},
    {"codigo": "18", "razao_social": "APOGEU ESPAÇO MÁGICO", "cnpj": "25.788.092/0001-47"},
    {"codigo": "20", "razao_social": "APOGEU CIDADE ALTA - INTEGRA", "cnpj": "66.448.143/0001-79"},
    {"codigo": "25", "razao_social": "COLÉGIO SARAH DAWSEY", "cnpj": "42.722.698/0001-07"},
    {"codigo": "26", "razao_social": "APOGEU SUDESTE", "cnpj": "32.555.626/0001-50"},
    {"codigo": "28", "razao_social": "PRO RAIZ", "cnpj": "49.218.279/0001-73"},
    {"codigo": "29", "razao_social": "COLÉGIO AMERICANO", "cnpj": "58.232.918/0001-46"},
    {"codigo": "30", "razao_social": "COLÉGIO UNIÃO", "cnpj": "58.241.128/0001-27"},
]

COMPANY_CODE_BY_CNPJ = {company["cnpj"]: company["codigo"] for company in COMPANIES}
