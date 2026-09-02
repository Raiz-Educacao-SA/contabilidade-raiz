export type MatchableIntercompanyEntry = {
  date: string;
  value: number;
  complement?: string;
  document?: string;
};

export type IntercompanyEntryDiagnosis = {
  receivableIndex: number | null;
  payableIndex: number | null;
  wrongAccountSource: "creditorPayable" | "debtorReceivable" | null;
  wrongAccountIndex: number | null;
  status:
    | "Conferido"
    | "Falta no ativo"
    | "Falta no passivo"
    | "Alteração de contas";
};

const normalizeText = (value?: string) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();

function matchScore(
  source: MatchableIntercompanyEntry,
  candidate: MatchableIntercompanyEntry,
) {
  const sourceComplement = normalizeText(source.complement);
  const candidateComplement = normalizeText(candidate.complement);
  const sourceDocument = normalizeText(source.document);
  const candidateDocument = normalizeText(candidate.document);
  return (
    (sourceComplement && sourceComplement === candidateComplement ? 100 : 0) +
    (sourceDocument && sourceDocument === candidateDocument ? 20 : 0)
  );
}

function findBestIndex(
  source: MatchableIntercompanyEntry,
  candidates: MatchableIntercompanyEntry[],
  used: Set<number>,
  valuesMatch: (
    source: MatchableIntercompanyEntry,
    candidate: MatchableIntercompanyEntry,
  ) => boolean,
) {
  return candidates.reduce(
    (best, candidate, index) => {
      if (
        used.has(index) ||
        candidate.date !== source.date ||
        !valuesMatch(source, candidate)
      )
        return best;
      const score = matchScore(source, candidate);
      if (score > best.score) return { index, score };
      return best;
    },
    { index: -1, score: -1 },
  ).index;
}

export function diagnoseIntercompanyEntries(
  expectedReceivables: MatchableIntercompanyEntry[],
  expectedPayables: MatchableIntercompanyEntry[],
  creditorWrongPayables: MatchableIntercompanyEntry[],
  debtorWrongReceivables: MatchableIntercompanyEntry[],
  tolerance = 1,
) {
  const usedPayables = new Set<number>();
  const usedCreditorWrongPayables = new Set<number>();
  const usedDebtorWrongReceivables = new Set<number>();
  const diagnostics: IntercompanyEntryDiagnosis[] = [];
  const inverseValuesMatch = (
    source: MatchableIntercompanyEntry,
    candidate: MatchableIntercompanyEntry,
  ) => Math.abs(source.value + candidate.value) <= tolerance;
  const absoluteValuesMatch = (
    source: MatchableIntercompanyEntry,
    candidate: MatchableIntercompanyEntry,
  ) => Math.abs(Math.abs(source.value) - Math.abs(candidate.value)) <= tolerance;

  expectedReceivables.forEach((receivable, receivableIndex) => {
    const payableIndex = findBestIndex(
      receivable,
      expectedPayables,
      usedPayables,
      inverseValuesMatch,
    );
    if (payableIndex >= 0) {
      usedPayables.add(payableIndex);
      diagnostics.push({
        receivableIndex,
        payableIndex,
        wrongAccountSource: null,
        wrongAccountIndex: null,
        status: "Conferido",
      });
      return;
    }

    const wrongAccountIndex = findBestIndex(
      receivable,
      debtorWrongReceivables,
      usedDebtorWrongReceivables,
      absoluteValuesMatch,
    );
    if (wrongAccountIndex >= 0) {
      usedDebtorWrongReceivables.add(wrongAccountIndex);
      diagnostics.push({
        receivableIndex,
        payableIndex: null,
        wrongAccountSource: "debtorReceivable",
        wrongAccountIndex,
        status: "Alteração de contas",
      });
      return;
    }

    diagnostics.push({
      receivableIndex,
      payableIndex: null,
      wrongAccountSource: null,
      wrongAccountIndex: null,
      status: "Falta no passivo",
    });
  });

  expectedPayables.forEach((payable, payableIndex) => {
    if (usedPayables.has(payableIndex)) return;
    const wrongAccountIndex = findBestIndex(
      payable,
      creditorWrongPayables,
      usedCreditorWrongPayables,
      absoluteValuesMatch,
    );
    if (wrongAccountIndex >= 0) {
      usedCreditorWrongPayables.add(wrongAccountIndex);
      diagnostics.push({
        receivableIndex: null,
        payableIndex,
        wrongAccountSource: "creditorPayable",
        wrongAccountIndex,
        status: "Alteração de contas",
      });
      return;
    }

    diagnostics.push({
      receivableIndex: null,
      payableIndex,
      wrongAccountSource: null,
      wrongAccountIndex: null,
      status: "Falta no ativo",
    });
  });

  return {
    diagnostics,
    usedCreditorWrongPayables,
    usedDebtorWrongReceivables,
  };
}
