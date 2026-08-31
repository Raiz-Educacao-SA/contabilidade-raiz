const revenueCacheDbName = "contabilidade-raiz-revenue-cache";
const revenueCacheStoreName = "revenue-reconciliations";

function openRevenueCache() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof window === "undefined" || !("indexedDB" in window)) {
      reject(new Error("IndexedDB indisponível."));
      return;
    }
    const request = window.indexedDB.open(revenueCacheDbName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(revenueCacheStoreName)) {
        request.result.createObjectStore(revenueCacheStoreName);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function revenueReconciliationCacheKey(companyCode: string, competence: string) {
  const normalizedCompany = String(companyCode || "").trim().padStart(2, "0");
  return `revenue-reconciliation:${normalizedCompany}:${competence}`;
}

export async function readRevenueReconciliationCache<T>(key: string): Promise<T | null> {
  try {
    const database = await openRevenueCache();
    return await new Promise<T | null>((resolve, reject) => {
      const transaction = database.transaction(revenueCacheStoreName, "readonly");
      const request = transaction.objectStore(revenueCacheStoreName).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => database.close();
    });
  } catch {
    return null;
  }
}

export async function writeRevenueReconciliationCache(key: string, value: unknown) {
  const database = await openRevenueCache();
  return await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(revenueCacheStoreName, "readwrite");
    transaction.objectStore(revenueCacheStoreName).put(value, key);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export async function deleteRevenueReconciliationCache(key: string) {
  try {
    const database = await openRevenueCache();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(revenueCacheStoreName, "readwrite");
      transaction.objectStore(revenueCacheStoreName).delete(key);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    });
  } catch {
    // A limpeza visual da tela não deve depender do cache local.
  }
}
