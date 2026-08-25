"use client";

import { useCallback, useEffect, useState } from "react";
import type { HrCompany } from "@/lib/hr/store";

/**
 * As empresas na folha, com o ano inteiro de semanas.
 *
 * Um hook só para as quatro telas de escritório, pela mesma razão que há uma
 * consulta só no servidor: elas fazem a mesma pergunta, e duas contagens da
 * mesma semana acabam sempre por discordar.
 */
export function useHrCompanies(year: number) {
  const [companies, setCompanies] = useState<HrCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/hr/companies?year=${year}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json()).error || "Falhou ao carregar.");
      const d = await r.json();
      setCompanies(d.companies || []);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    load();
  }, [load]);

  return { companies, loading, erro, reload: load };
}
