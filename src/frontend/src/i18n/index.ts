import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  it: {
    translation: {
      brand: { tagline: "La città è il tuo gioco" },
      app: {
        eyebrow: "Benvenuto a Edonism",
        title: "Una città da costruire.\nInfinite storie da vivere.",
        description: "Esplora la plancia originale ricostruita in 3D: 30 spazi per attività, 7 strade collegate e il Municipio al centro. Il gameplay PvP arriverà successivamente.",
        foundation: "Plancia originale · 0.0.2",
        preview: "Anteprima tecnica",
        coming: "Il gioco prende forma",
      },
      theme: { label: "Tema", system: "Sistema", light: "Chiaro", dark: "Scuro" },
      settings: { language: "Lingua" },
      city: {
        title: "La città di Edonism",
        subtitle: "30 spazi attività · 7 strade · Vista 3D",
        canvasLabel: "Ricostruzione 3D della plancia originale",
        controls: "Trascina per ruotare · Scorri per zoom",
        fallback: "Il 3D non è disponibile su questo dispositivo. Puoi comunque esplorare strade e spazi dal pannello.",
        previewTag: "Plancia originale · Rendering 3D",
        inspect: "Esplora la plancia",
        streetHelp: "Seleziona una strada per vedere gli spazi e i collegamenti. Non stai muovendo un personaggio.",
        selectedStreet: "Strada selezionata",
        selectedSlot: "Spazio selezionato",
        activitySpaces: "Spazi attività",
        slotsShort: "spazi",
        adjacentStreets: "Strade adiacenti (1 movimento)",
        cityHall: "Municipio",
        mainSquareOnly: "Il Municipio occupa il centro; non ci sono spazi attività.",
        streets: "Le 7 strade",
        selectSlot: "Seleziona uno spazio attività",
        inspectSlot: "Seleziona lo spazio {{id}}",
        worldStatus: "Stato del mondo",
        worldValue: "Anteprima statica",
        notice: "Topologia ripresa dalla plancia originale. Gli edifici sono modelli temporanei: non rappresentano carte attività assegnate.",
        noRules: "La selezione delle strade è solo esplorativa. Nessuna partita, economia o azione PvP è ancora attiva.",
        figurinestitle: "I Pucciottini",
        figurinesdescription: "Piccoli personaggi 3D illustrativi. Non rappresentano ancora giocatori o posizioni di partita.",
        accessibility: "Le strade e gli spazi si possono selezionare anche senza WebGL, tramite pulsanti accessibili.",
      },
      footer: { message: "Edonism · Una città tutta da immaginare" },
    },
  },
  en: {
    translation: {
      brand: { tagline: "The city is your game" },
      app: {
        eyebrow: "Welcome to Edonism",
        title: "A city to build.\nEndless stories to tell.",
        description: "Explore the original board rebuilt in 3D: 30 activity spaces, 7 linked streets and City Hall at its center. PvP gameplay will come later.",
        foundation: "Original board · 0.0.2",
        preview: "Technical preview",
        coming: "The game is taking shape",
      },
      theme: { label: "Theme", system: "System", light: "Light", dark: "Dark" },
      settings: { language: "Language" },
      city: {
        title: "The city of Edonism",
        subtitle: "30 activity spaces · 7 streets · 3D view",
        canvasLabel: "3D reconstruction of the original board",
        controls: "Drag to orbit · Scroll to zoom",
        fallback: "3D is not available on this device. You can still explore streets and spaces from the panel.",
        previewTag: "Original board · 3D rendering",
        inspect: "Explore the board",
        streetHelp: "Select a street to view spaces and connections. This does not move a character.",
        selectedStreet: "Selected street",
        selectedSlot: "Selected space",
        activitySpaces: "Activity spaces",
        slotsShort: "spaces",
        adjacentStreets: "Adjacent streets (one move)",
        cityHall: "City Hall",
        mainSquareOnly: "City Hall is in the center; there are no activity spaces.",
        streets: "The 7 streets",
        selectSlot: "Choose an activity space",
        inspectSlot: "Select space {{id}}",
        worldStatus: "World status",
        worldValue: "Static preview",
        notice: "Topology comes from the original board. Buildings are temporary models, not assigned activity cards.",
        noRules: "Street selection is just exploration. No match, economy or PvP action is active yet.",
        figurinestitle: "The Pucciottini",
        figurinesdescription: "Illustrative little 3D characters. They do not represent players or in-match positions yet.",
        accessibility: "Accessible buttons let you select streets and spaces without WebGL.",
      },
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
