import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    environment: "node",
    // Sales Ownership / Marketing Demand Decoupling: das jetzt 84 Tage breite
    // Produktionsregime (statt vormals 31 Tage) macht Weltgenerierung pro Test
    // spürbar teurer (mehr rejection-sampling-Iterationen über einen größeren
    // Kalenderanteil). Mehrere Tests, die 6+ volle Welten generieren, überschreiten
    // dadurch die 5s-Vitest-Default-Grenze NUR unter voller Suite-Parallelität
    // (jeder betroffene Test lief standalone in 1-6s) — ein reines
    // Ressourcenkontentions-Zeitbudget-Thema, keine Logikänderung. Statt jeden
    // einzelnen betroffenen Test individuell zu patchen, global angehoben.
    testTimeout: 20000,
  },
});
