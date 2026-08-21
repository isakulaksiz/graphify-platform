import { useEffect, useState } from "react";

/**
 * Tema seçimi.
 *
 * Üç durum var ve "system" ayrı tutuluyor: kullanıcı seçim yapmadıysa işletim
 * sisteminin tercihini izliyoruz.
 *
 * TASARIM KARARI: "system" durumunu BURADA çözüp `<html data-theme>` üzerine
 * somut değeri yazıyoruz. Alternatif, CSS'te `prefers-color-scheme` medya
 * sorgusu kullanmaktı; o zaman aynı ~25 satırlık renk bloğunu iki kez yazmak
 * gerekiyordu (bir kez açık seçim, bir kez sistem tercihi için) ve ikisi
 * zamanla kolayca birbirinden ayrılırdı. Böylece CSS'te tek blok kalıyor.
 *
 * Seçim localStorage'da: kimliğe bağlı olmayan, tamamen yerel görüntü tercihi.
 */
export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "graphify-theme";
const QUERY = "(prefers-color-scheme: dark)";

function readStored(): ThemeChoice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") return value;
  } catch {
    // Gizli sekmede localStorage erişimi hata verebilir; sistemi izle.
  }
  return "system";
}

function systemTheme(): "light" | "dark" {
  return window.matchMedia?.(QUERY).matches ? "dark" : "light";
}

/** Seçimi somut temaya çevirip köke yazar. */
function apply(choice: ThemeChoice): void {
  const resolved = choice === "system" ? systemTheme() : choice;
  document.documentElement.setAttribute("data-theme", resolved);
}

export function useTheme(): [ThemeChoice, (next: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(readStored);

  useEffect(() => {
    apply(choice);
    try {
      localStorage.setItem(STORAGE_KEY, choice);
    } catch {
      // Yazamazsak da tema bu oturumda çalışmaya devam eder.
    }
  }, [choice]);

  // "Sistem" seçiliyken kullanıcı makinesinin temasını değiştirirse takip et.
  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia?.(QUERY);
    if (!media) return;

    const onChange = (): void => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);

  return [choice, setChoice];
}

/** İlk boyamadan önce temayı uygula — sayfa yanıp sönmesin. */
export function initTheme(): void {
  apply(readStored());
}
