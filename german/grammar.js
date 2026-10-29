// Grammar points the writing task rotates through, in teaching order. The
// AI tags each correction with one of these ids (or "other"), which drives
// the focus rotation, the rule cards and the "most frequent fixes" list.
//
// `level` is the first level the point is used as a writing focus at.
// `rule` is the rule card for the point: an English question on the front,
// the rule with a model sentence on the back (your own corrected sentences
// are added under it as examples).

export const POINTS = [
  {
    id: "v2", level: "A1.2", label: "Verb second after time words",
    hint: "Start one sentence with a time word, then the verb.", model: "Gestern bin ich …",
    rule: { q: "A sentence starts with “Gestern”. Where does the verb go?", a: "Second — right after the first part: Gestern bin ich …" },
  },
  {
    id: "perfekt", level: "A2.1", label: "Perfekt with haben / sein",
    hint: "Tell what you did in the Perfekt; movement and change take sein.", model: "Ich bin gefahren, ich habe gegessen.",
    rule: { q: "Perfekt: when do you use sein instead of haben?", a: "With movement or change of state (gehen, fahren, werden, bleiben): Ich bin gefahren." },
  },
  {
    id: "weil", level: "A2.1", label: "weil → verb at the end",
    hint: "Try weil once: the verb goes to the end.", model: "…, weil ich müde war.",
    rule: { q: "After “weil”, where does the verb go?", a: "To the very end: …, weil ich frei hatte." },
  },
  {
    id: "dativ-praep", level: "A2.1", label: "mit, bei, nach, von, zu, aus + Dativ",
    hint: "Use mit, bei or nach once — they always take the dative.", model: "mit meinen Freunden",
    rule: { q: "Which case comes after mit, bei, nach, von, zu, aus, seit?", a: "Always the dative: mit dem Zug, mit meinen Freunden." },
  },
  {
    id: "modal", level: "A2.1", label: "Modal verb → infinitive at the end",
    hint: "Use können, müssen or wollen; the second verb goes to the end.", model: "Ich muss morgen früh aufstehen.",
    rule: { q: "With a modal verb (können, müssen, …), where does the other verb go?", a: "Infinitive at the end: Ich muss heute lernen." },
  },
  {
    id: "trennbar", level: "A2.1", label: "Separable verbs",
    hint: "Use a separable verb (ankommen, einkaufen); the prefix goes to the end.", model: "Der Zug kommt um acht an.",
    rule: { q: "Separable verb in a main clause: where does the prefix go?", a: "To the end: Ich kaufe heute ein. (Perfekt: eingekauft)" },
  },
  {
    id: "wechsel", level: "A2.2", label: "in, an, auf: Akkusativ or Dativ",
    hint: "Say where something is (Dativ) and where it goes (Akkusativ).", model: "Ich gehe in die Halle. Ich bin in der Halle.",
    rule: { q: "in / an / auf: when Akkusativ, when Dativ?", a: "Wohin? (movement) → Akkusativ: in die Stadt. Wo? (place) → Dativ: in der Stadt." },
  },
  {
    id: "dass", level: "A2.2", label: "dass, wenn, ob → verb at the end",
    hint: "Use dass or wenn once; the verb goes to the end.", model: "Ich glaube, dass es morgen regnet.",
    rule: { q: "After “dass”, “wenn” or “ob”, where does the verb go?", a: "To the end, like after weil: …, dass es regnet." },
  },
  {
    id: "praeteritum", level: "A2.2", label: "Präteritum of sein, haben, modals",
    hint: "Use war, hatte or konnte once.", model: "Gestern war ich müde.",
    rule: { q: "Past of sein, haben and modal verbs in speech?", a: "Präteritum: war, hatte, konnte, musste — not “bin gewesen”." },
  },
  {
    id: "adj", level: "A2.2", label: "Adjective endings",
    hint: "Describe something with an adjective before a noun.", model: "ein schöner Tag, mit dem neuen Rad",
    rule: { q: "Adjective after “ein” / “dem”: which ending?", a: "ein schöner Tag (Nom. m.), mit dem neuen Rad (Dativ → -en)." },
  },
  {
    id: "komparativ", level: "A2.2", label: "Comparing: -er als, am -sten",
    hint: "Compare two things once.", model: "Der Zug ist schneller als der Bus.",
    rule: { q: "How do you compare two things?", a: "Adjective + -er + als: schneller als; the most: am schnellsten." },
  },
  {
    id: "reflexiv", level: "B1.1", label: "Reflexive verbs",
    hint: "Use a reflexive verb (sich freuen, sich treffen).", model: "Ich freue mich auf das Wochenende.",
    rule: { q: "sich freuen: which pronoun goes with “ich”?", a: "mich: Ich freue mich. (du → dich, wir → uns)" },
  },
  {
    id: "zu-inf", level: "B1.1", label: "zu + infinitive",
    hint: "Use a zu + infinitive phrase (Ich habe keine Zeit, … zu …).", model: "Ich habe keine Lust, heute zu kochen.",
    rule: { q: "“Ich habe keine Lust, … (kochen)” — how does it end?", a: "With zu + infinitive at the end: …, heute zu kochen." },
  },
  {
    id: "relativ", level: "B1.1", label: "Relative clauses",
    hint: "Describe a person or thing with der/die/das + verb at the end.", model: "Das ist der Kurs, der mir hilft.",
    rule: { q: "Relative clause: which word starts it and where does the verb go?", a: "der/die/das (matching the noun), verb at the end: der Kurs, der mir hilft." },
  },
  {
    id: "konjunktiv", level: "B1.2", label: "würde, hätte, wäre",
    hint: "Say what you would do: würde / hätte / wäre.", model: "Wenn ich Zeit hätte, würde ich mehr klettern.",
    rule: { q: "How do you say what you would do or would have?", a: "würde + infinitive, hätte, wäre: Ich würde gern reisen." },
  },
];

export const POINT_IDS = POINTS.map(p => p.id);

export const pointById = id => POINTS.find(p => p.id === id) || null;

export function pointLabel(id) {
  return pointById(id)?.label || "Other";
}
