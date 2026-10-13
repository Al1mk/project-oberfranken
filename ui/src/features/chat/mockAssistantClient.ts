import type { LocalizedText } from "../../i18n/types";
import type { AssistantClient, AssistantReply, AssistantReplyKind, AssistantRequest } from "./assistantClient";

/*
 * Deterministic, local sample responses. No network, no LLM, no retrieval.
 * Rules are checked top to bottom; the first match wins.
 */

type MockRule = {
  id: string;
  kind: AssistantReplyKind;
  matches: (text: string, request: AssistantRequest) => boolean;
  reply: LocalizedText;
};

const has = (text: string, ...words: string[]) => words.some((word) => text.includes(word));
const pageCity = (request: AssistantRequest) => request.selectedCity ?? request.city;
const cityIs = (text: string, request: AssistantRequest, city: "bamberg" | "bayreuth") =>
  text.includes(city) || (pageCity(request) === city && !has(text, city === "bamberg" ? "bayreuth" : "bamberg"));

const RULES: MockRule[] = [
  {
    id: "housing",
    kind: "out-of-scope",
    matches: (text) => /\b(apartments?|flats?|housing|rent(al)?|rooms?|accommodation|wohnung(en)?|miete|zimmer|wg|unterkunft)\b/.test(text),
    reply: {
      en: "Live housing search is outside the scope of this pilot. I can’t check which apartments are available. For accommodation, please contact the student services organisation (Studierendenwerk) or the official channels of your city or university.",
      de: "Eine Live-Wohnungssuche liegt außerhalb des Pilotumfangs. Ich kann nicht prüfen, welche Wohnungen verfügbar sind. Wende dich für Unterkünfte bitte an das Studierendenwerk oder an die offiziellen Kanäle deiner Stadt oder Universität.",
    },
  },
  {
    id: "advice",
    kind: "out-of-scope",
    matches: (text) =>
      /\b(visa|visum|residence permit|aufenthalt\w*|legal|lawyer|rechtlich\w*|anwalt|doctors?|medical|arzt|medizin\w*|jobs?)\b/.test(text),
    reply: {
      en: "Visa, legal, medical and job questions are outside the scope of this pilot. Please use the official advisory services of your city or university for these topics.",
      de: "Fragen zu Visum, Recht, Gesundheit und Jobs liegen außerhalb des Pilotumfangs. Bitte nutze dafür die offiziellen Beratungsangebote deiner Stadt oder Universität.",
    },
  },
  {
    id: "clarify-city",
    kind: "clarification",
    // A broad place question with no city named, no page city and no explicit selection.
    matches: (text, request) =>
      !pageCity(request) &&
      !has(text, "bamberg", "bayreuth") &&
      /\b(restaurants?|sights?|sightseeing|attractions?|sehenswürdigkeiten|sehenswuerdigkeiten|essen gehen|activit\w*|museums?|traditions?|aktivit\w*)\b/.test(text),
    reply: {
      en: "Sample reply: which city do you mean, Bamberg or Bayreuth?",
      de: "Beispielantwort: Welche Stadt meinst du, Bamberg oder Bayreuth?",
    },
  },
  {
    id: "bamberg-tradition",
    kind: "answer",
    matches: (text, request) =>
      cityIs(text, request, "bamberg") && has(text, "tradition", "custom", "culture", "brauch", "kultur", "heritage"),
    reply: {
      en: "A good starting point in Bamberg is its brewing culture, including the smoked beer (Rauchbier) the city is known for, and the old town, which is a UNESCO World Heritage Site. See “Culture & Tradition” on the Bamberg page for more. In the full version, this answer will be based on curated official sources.",
      de: "Ein guter Einstieg in Bamberg ist die Braukultur, darunter das Rauchbier, für das die Stadt bekannt ist, sowie die Altstadt, die UNESCO-Welterbe ist. Mehr dazu unter „Kultur & Tradition“ auf der Bamberg-Seite. In der finalen Version stützt sich diese Antwort auf kuratierte offizielle Quellen.",
    },
  },
  {
    id: "bayreuth-activities",
    kind: "answer",
    matches: (text, request) =>
      cityIs(text, request, "bayreuth") &&
      has(text, "activit", "visit", "cultural", "concert", "museum", "aktivit", "besuch", "kulturangebot", "veranstaltung"),
    reply: {
      en: "In Bayreuth, many cultural offers are open to the public, for example museums, concerts and exhibitions, and the university has student groups and language exchanges. The city is also known for the Richard Wagner Festival in summer. This prototype does not show live dates, so please check the official city and university listings.",
      de: "In Bayreuth sind viele Kulturangebote öffentlich zugänglich, etwa Museen, Konzerte und Ausstellungen, und die Universität bietet Hochschulgruppen und Sprachtandems. Bekannt ist die Stadt außerdem für die Richard-Wagner-Festspiele im Sommer. Dieser Prototyp zeigt keine Live-Termine – bitte prüfe die offiziellen Angebote von Stadt und Universität.",
    },
  },
  {
    id: "registration",
    kind: "answer",
    matches: (text) => has(text, "register", "registration", "anmeld", "bürgeramt", "buergeramt", "international office"),
    reply: {
      en: "Newcomers in Germany generally register their address with the local citizens’ office after moving, and international students usually start with their university’s International Office. The “Official Newcomer Information” section on each city page lists where this will link to.",
      de: "Wer nach Deutschland zieht, meldet seine Adresse in der Regel beim örtlichen Bürgeramt an, und internationale Studierende wenden sich meist zuerst an das International Office ihrer Universität. Im Abschnitt „Offizielle Informationen für Neuankommende“ jeder Stadtseite siehst du, wohin das später verlinkt.",
    },
  },
  {
    id: "greeting",
    kind: "answer",
    matches: (text) => /^(hi|hello|hey|hallo|servus|moin|guten tag)\b/.test(text),
    reply: {
      en: "Hello! Ask me about culture and traditions, public activities, or first official steps in Bamberg or Bayreuth.",
      de: "Hallo! Frag mich nach Kultur und Traditionen, öffentlichen Angeboten oder ersten offiziellen Schritten in Bamberg oder Bayreuth.",
    },
  },
];

const FALLBACK: LocalizedText = {
  en: "This prototype only has sample answers for a few example questions, so I can’t answer that yet. Try asking about a regional tradition in Bamberg or public cultural activities in Bayreuth.",
  de: "Dieser Prototyp hat nur Beispielantworten für einige Beispielfragen, deshalb kann ich das noch nicht beantworten. Frag zum Beispiel nach einer regionalen Tradition in Bamberg oder nach öffentlichen Kulturangeboten in Bayreuth.",
};

export function resolveMockReply(request: AssistantRequest): AssistantReply {
  const text = request.message.toLowerCase().trim() + " ";
  const rule = RULES.find((candidate) => candidate.matches(text, request));
  return {
    text: (rule?.reply ?? FALLBACK)[request.language],
    kind: rule?.kind ?? "fallback",
    isSample: true,
    sources: [],
  };
}

export function createMockAssistantClient({ delayMs = 700 }: { delayMs?: number } = {}): AssistantClient {
  return {
    mode: "mock",
    send(request, options) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve(resolveMockReply(request)), delayMs);
        options?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    },
  };
}
