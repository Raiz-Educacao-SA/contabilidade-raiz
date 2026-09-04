import assert from "node:assert/strict";
import test from "node:test";
import { parseNfeOcr, parseNfeXml } from "../lib/nfe-items.ts";

test("lê o detalhamento fiscal de cada item do XML da NF-e", () => {
  const items = parseNfeXml(`<nfeProc><NFe><infNFe><det nItem="1"><prod><cProd>1760</cProd><xProd>COMPRESSOR 1/6HP 127V</xProd><NCM>84143011</NCM><CFOP>5102</CFOP><uCom>PC</uCom><qCom>1.0000</qCom><vUnCom>499.9000</vUnCom><vProd>499.90</vProd></prod><imposto><ICMS><ICMS00><CST>00</CST><vBC>499.90</vBC><pICMS>18.00</pICMS><vICMS>89.98</vICMS></ICMS00></ICMS><IPI><IPITrib><pIPI>5.00</pIPI><vIPI>24.99</vIPI></IPITrib></IPI></imposto></det></infNFe></NFe></nfeProc>`);
  assert.equal(items.length, 1);
  assert.deepEqual(items[0], { code: "1760", description: "COMPRESSOR 1/6HP 127V", ncm: "84143011", cst: "00", cfop: "5102", unit: "PC", quantity: 1, unitValue: 499.9, total: 499.9, icmsBase: 499.9, icmsValue: 89.98, ipiValue: 24.99, icmsRate: 18, ipiRate: 5 });
});

test("recompõe descrições quebradas em mais de uma linha na DANFE", () => {
  const items = parseNfeOcr(`DADOS DO PRODUTO/SERVIÇO
CÓDIGO DESCRIÇÃO DO PRODUTO/SERVIÇO NCM/SH CST/CSOSN CFOP UNID. QTD. VLR. UNIT. VLR. TOTAL
1760 COMPRESSOR 1/6HP 127V R-134A
EMI60HER - EMBRACO. 84143011 0102 5102 PC 1 499,90 499,90
11460 PROTETOR TERMICO PTC COBRE
UNIVERSAL 4TM 110V - VIX* 85363090 0102 5102 PC 5 9,90 49,50`);
  assert.equal(items.length, 2);
  assert.equal(items[0].description, "COMPRESSOR 1/6HP 127V R-134A EMI60HER - EMBRACO.");
  assert.equal(items[1].total, 49.5);
});
