import { Platform } from 'react-native';

/**
 * Stockage clé-valeur DURABLE (survit au redémarrage, sans réseau) :
 * expo-sqlite/kv-store sur Android/iOS, localStorage sur le web.
 * Chargé à la demande : si le module natif manquait, repli en mémoire au lieu
 * de faire planter l'application (même principe que db/database.ts).
 */
declare const require: (id: string) => any;

interface Stockage {
  getItem(cle: string): Promise<string | null>;
  setItem(cle: string, valeur: string): Promise<void>;
  removeItem(cle: string): Promise<unknown>;
}

const memoire = new Map<string, string>();
const stockageMemoire: Stockage = {
  getItem: async (c) => memoire.get(c) ?? null,
  setItem: async (c, v) => {
    memoire.set(c, v);
  },
  removeItem: async (c) => memoire.delete(c),
};

let instance: Stockage | null = null;

export function stockageLocal(): Stockage {
  if (instance) return instance;
  if (Platform.OS === 'web') {
    const ls = typeof globalThis.localStorage !== 'undefined' ? globalThis.localStorage : null;
    instance = ls
      ? {
          getItem: async (c) => ls.getItem(c),
          setItem: async (c, v) => {
            try { ls.setItem(c, v); } catch { /* quota : ignoré */ }
          },
          removeItem: async (c) => ls.removeItem(c),
        }
      : stockageMemoire;
    return instance;
  }
  try {
    const kv = require('expo-sqlite/kv-store');
    const s = kv.default ?? kv.Storage ?? kv.AsyncStorage;
    instance = {
      getItem: (c) => s.getItem(c),
      setItem: (c, v) => s.setItem(c, v),
      removeItem: (c) => s.removeItem(c),
    };
  } catch (erreur) {
    console.warn('[stockage] SQLite indisponible, stockage en mémoire :', erreur instanceof Error ? erreur.message : erreur);
    instance = stockageMemoire;
  }
  return instance;
}
