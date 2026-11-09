import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  it: {
    translation: {
      brand: { tagline: "La città è il tuo gioco" },
      app: {
        eyebrow: "Benvenuto a Edonism",
        title: "Una città da costruire.\nInfinite storie da vivere.",
        description: "Esplora l'anteprima tridimensionale del tabellone. Le attività, le proprietà e le regole PvP arriveranno con il game design ufficiale.",
        foundation: "Foundation 0.0.1",
        preview: "Anteprima tecnica",
        coming: "Il gioco prende forma",
      },
      theme: { label: "Tema", system: "Sistema", light: "Chiaro", dark: "Scuro" },
      settings: { language: "Lingua" },
      city: {
        title: "La città di Edonism",
        subtitle: "Esagoni 3D · Pucciottini · Vista isometrica",
        canvasLabel: "Anteprima della mappa 3D",
        controls: "Trascina per ruotare · Scorri per zoom",
        fallback: "Il 3D non è disponibile su questo dispositivo. Puoi comunque esplorare gli esagoni dal pannello.",
        previewTag: "Visualizzazione demo",
        inspect: "Esplora gli esagoni",
        inspectHelp: "Seleziona una casella per vederne i dettagli. Questa anteprima non modifica lo stato di gioco.",
        inspectHex: "Esagono {{q}}, {{r}}",
        active: "Esagono selezionato",
        coordinate: "Coordinate assiali",
        district: "Destinazione illustrativa",
        worldStatus: "Stato del mondo",
        worldValue: "Non ancora connesso",
        notice: "La città è un prototipo visivo, non una partita attiva.",
        noRules: "Nessuna economia o regola PvP è attiva in questa versione.",
        figurinestitle: "I Pucciottini",
        figurinesdescription: "Piccoli personaggi 3D realizzati con forme temporanee. I modelli definitivi arriveranno più avanti.",
        accessibility: "I controlli nel pannello permettono la selezione anche senza WebGL.",
      },
      tiles: { civic: "Centro civico", commerce: "Attività commerciale", park: "Parco", residential: "Quartiere" },
      footer: { message: "Edonism · Una città tutta da immaginare" },
    },
  },
  en: {
    translation: {
      brand: { tagline: "The city is your game" },
      app: {
        eyebrow: "Welcome to Edonism",
        title: "A city to build.\nEndless stories to tell.",
        description: "Explore the 3D preview of the board. Businesses, properties and PvP rules will follow the approved game design.",
        foundation: "Foundation 0.0.1",
        preview: "Technical preview",
        coming: "The game is taking shape",
      },
      theme: { label: "Theme", system: "System", light: "Light", dark: "Dark" },
      settings: { language: "Language" },
      city: {
        title: "The city of Edonism",
        subtitle: "3D hexes · Pucciottini · Isometric view",
        canvasLabel: "3D city map preview",
        controls: "Drag to orbit · Scroll to zoom",
        fallback: "3D is not available on this device. You can still explore hexes from the panel.",
        previewTag: "Demo visualization",
        inspect: "Explore the hexes",
        inspectHelp: "Select a tile to inspect it. This preview does not change game state.",
        inspectHex: "Hex {{q}}, {{r}}",
        active: "Selected hex",
        coordinate: "Axial coordinates",
        district: "Illustrative designation",
        worldStatus: "World status",
        worldValue: "Not connected yet",
        notice: "The city is a visual prototype, not an active match.",
        noRules: "No economy or PvP rules are active in this version.",
        figurinestitle: "The Pucciottini",
        figurinesdescription: "Little 3D characters made from temporary shapes. Final character models will come later.",
        accessibility: "Panel controls also let you select tiles without WebGL.",
      },
      tiles: { civic: "City center", commerce: "Business", park: "Park", residential: "Neighborhood" },
      footer: { message: "Edonism · A city waiting to happen" },
    },
  },
} as const;

const storedLanguage = typeof window === "undefined" ? null : window.localStorage.getItem("edonism-language");
const language = storedLanguage === "en" ? "en" : "it";

void i18n.use(initReactI18next).init({
  resources,
  lng: language,
  fallbackLng: "it",
  interpolation: { escapeValue: false },
});

export function changeLanguage(next: "it" | "en"): void {
  window.localStorage.setItem("edonism-language", next);
  void i18n.changeLanguage(next);
  document.documentElement.lang = next;
}

export default i18n;
