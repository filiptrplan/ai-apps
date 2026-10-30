// What the learner can do at their level, for the German app's AI prompts.
// The descriptors are quoted from the CEFR Companion Volume (Council of
// Europe, 2020), with the sign-language variants ("words/signs") left out.
// german/LEVELS.md documents the same guidance; keep the two in sync.
//
// The app's sub-levels map onto CEFR levels: X.1 is X and X.2 is the plus
// level (A2+, B1+, B2+; A1 has none), which includes the base level's
// descriptors. Each task picks the scales that fit what it generates.

type Cefr = "A1" | "A2" | "A2+" | "B1" | "B1+" | "B2" | "B2+";

const SCALES: Record<string, Partial<Record<Cefr, string[]>>> = {
  "Overall oral comprehension": {
    "A1": [
      "Can follow language which is very slow and carefully articulated, with long pauses for them to assimilate meaning.",
      "Can recognise concrete information (e.g. places and times) on familiar topics encountered in everyday life, provided it is delivered slowly and clearly.",
    ],
    "A2": [
      "Can understand phrases and expressions related to areas of most immediate priority (e.g. very basic personal and family information, shopping, local geography, employment), provided people articulate clearly and slowly.",
    ],
    "A2+": [
      "Can understand enough to be able to meet needs of a concrete type, provided people articulate clearly and slowly.",
    ],
    "B1": [
      "Can understand the main points made in clear standard language or a familiar variety on familiar matters regularly encountered at work, school, leisure, etc., including short narratives.",
    ],
    "B1+": [
      "Can understand straightforward factual information about common everyday or job-related topics, identifying both general messages and specific details, provided people articulate clearly in a generally familiar variety.",
    ],
    "B2": [
      "Can understand the main ideas of propositionally and linguistically complex discourse on both concrete and abstract topics delivered in standard language or a familiar variety, including technical discussions in their field of specialisation.",
      "Can follow extended discourse and complex lines of argument, provided the topic is reasonably familiar, and the direction of the argument is signposted by explicit markers.",
    ],
    "B2+": [
      "Can understand standard language or a familiar variety, live or broadcast, on both familiar and unfamiliar topics normally encountered in personal, social, academic or vocational life. Only extreme background noise, inadequate discourse structure and/or idiomatic usage influence the ability to understand.",
    ],
  },
  "Understanding conversation between other people": {
    "A1": [
      "Can understand some expressions when people are discussing them, family, school, hobbies or surroundings, provided the delivery is slow and clear.",
      "Can understand words and short sentences in a simple conversation (e.g. between a customer and a salesperson in a shop), provided people communicate very slowly and very clearly.",
    ],
    "A2": [
      "Can follow in outline short, simple social exchanges, conducted very slowly and clearly.",
    ],
    "A2+": [
      "Can generally identify the topic of discussion around them when it is conducted slowly and clearly.",
      "Can recognise when people agree and disagree in a conversation conducted slowly and clearly.",
    ],
    "B1": [
      "Can generally follow the main points of extended discussion around them, provided it is clearly articulated in standard language or a familiar variety.",
    ],
    "B1+": [
      "Can follow much of everyday conversation and discussion, provided it is clearly articulated in standard language or in a familiar variety.",
    ],
    "B2": [
      "Can with some effort catch much of what is said around them, but may find it difficult to participate effectively in discussion with several users of the target language who do not modify their language in any way.",
      "Can identify the main reasons for and against an argument or idea in a discussion conducted in clear standard language or a familiar variety.",
      "Can follow chronological sequence in extended informal discourse, e.g. in a story or anecdote.",
    ],
    "B2+": [
      "Can keep up with an animated conversation between proficient users of the target language.",
    ],
  },
  "Understanding audio media and recordings": {
    "A1": [
      "Can pick out concrete information (e.g. places and times) from short recordings on familiar everyday topics, provided they are delivered very slowly and clearly.",
    ],
    "A2": [
      "Can understand and extract the essential information from short, recorded passages dealing with predictable everyday matters which are delivered slowly and clearly.",
      "Can extract important information from short broadcasts (e.g. the weather forecast, concert announcements, sports results), provided people talk clearly.",
      "Can understand the important points of a story and manage to follow the plot, provided the story is told slowly and clearly.",
    ],
    "A2+": [
      "Can understand the most important information contained in short commercials concerning goods and services of interest (e.g. CDs, video games, travel).",
      "Can understand in an interview what people say they do in their free time, what they particularly like doing and what they do not like doing, provided they speak slowly and clearly.",
    ],
    "B1": [
      "Can understand the main points of news bulletins and simpler recorded material about familiar subjects delivered relatively slowly and clearly.",
      "Can understand the main points and important details in stories and other narratives (e.g. a description of a holiday), provided the delivery is slow and clear.",
    ],
    "B1+": [
      "Can understand the information content of the majority of recorded or broadcast material on topics of personal interest delivered in clear standard language.",
    ],
    "B2": [
      "Can understand most documentaries and most other recorded or broadcast material delivered in the standard form of the language and can identify mood, attitude, etc.",
    ],
    "B2+": [
      "Can understand recordings in the standard form of the language likely to be encountered in social, professional or academic life and identify viewpoints and attitudes as well as the information content.",
    ],
  },
  "Overall reading comprehension": {
    "A1": [
      "Can understand very short, simple texts a single phrase at a time, picking up familiar names, words and basic phrases and rereading as required.",
    ],
    "A2": [
      "Can understand short, simple texts containing the highest frequency vocabulary, including a proportion of shared international vocabulary items.",
    ],
    "A2+": [
      "Can understand short, simple texts on familiar matters of a concrete type which consist of high frequency everyday or job-related language.",
    ],
    "B1": [
      "Can read straightforward factual texts on subjects related to their field of interest with a satisfactory level of comprehension.",
    ],
    "B2": [
      "Can read with a large degree of independence, adapting style and speed of reading to different texts and purposes, and using appropriate reference sources selectively. Has a broad active reading vocabulary, but may experience some difficulty with low-frequency idioms.",
    ],
  },
  "Overall written production": {
    "A1": [
      "Can give information about matters of personal relevance (e.g. likes and dislikes, family, pets) using simple words and basic expressions.",
      "Can produce simple isolated phrases and sentences.",
    ],
    "A2": [
      "Can produce a series of simple phrases and sentences linked with simple connectors like “and”, “but” and “because”.",
    ],
    "B1": [
      "Can produce straightforward connected texts on a range of familiar subjects within their field of interest, by linking a series of shorter discrete elements into a linear sequence.",
    ],
    "B2": [
      "Can produce clear, detailed texts on a variety of subjects related to their field of interest, synthesising and evaluating information and arguments from a number of sources.",
    ],
  },
  "Creative writing": {
    "A1": [
      "Can produce simple phrases and sentences about themselves and imaginary people, where they live and what they do.",
      "Can describe in very simple language what a room looks like.",
      "Can use simple words and phrases to describe certain everyday objects (e.g. the colour of a car, whether it is big or small).",
    ],
    "A2": [
      "Can produce a series of simple phrases and sentences about their family, living conditions, educational background, or present or most recent job.",
      "Can create short, simple imaginary biographies and simple poems about people.",
      "Can create diary entries that describe activities (e.g. daily routine, outings, sports, hobbies), people and places, using basic, concrete vocabulary and simple phrases and sentences with simple connectives like “and”, “but” and “because”.",
      "Can compose an introduction to a story or continue a story, provided they can consult a dictionary and references (e.g. tables of verb tenses in a course book).",
    ],
    "A2+": [
      "Can describe everyday aspects of their environment e.g. people, places, a job or study experience in linked sentences.",
      "Can give very short, basic descriptions of events, past activities and personal experiences.",
      "Can tell a simple story (e.g. about events on a holiday or about life in the distant future).",
    ],
    "B1": [
      "Can give straightforward, detailed descriptions on a range of familiar subjects within their field of interest.",
      "Can give accounts of experiences, describing feelings and reactions in simple, connected text.",
      "Can give a description of an event, a recent trip – real or imagined.",
      "Can narrate a story.",
    ],
    "B1+": [
      "Can clearly signal chronological sequence in narrative text.",
      "Can give a simple review of a film, book or TV programme using a limited range of language.",
    ],
    "B2": [
      "Can give clear, detailed descriptions on a variety of subjects related to their field of interest.",
      "Can give a review of a film, book or play.",
    ],
    "B2+": [
      "Can give clear, detailed descriptions of real or imaginary events and experiences marking the relationship between ideas in clear connected text, and following established conventions of the genre concerned.",
    ],
  },
  "Coherence and cohesion": {
    "A1": [
      "Can link words or groups of words with very basic linear connectors (e.g. “and” or “then”).",
    ],
    "A2": [
      "Can link groups of words with simple connectors (e.g. “and”, “but” and “because”).",
    ],
    "A2+": [
      "Can use the most frequently occurring connectors to link simple sentences in order to tell a story or describe something as a simple list of points.",
    ],
    "B1": [
      "Can link a series of shorter, discrete simple elements into a connected, linear sequence of points.",
      "Can form longer sentences and link them together using a limited number of cohesive devices, e.g. in a story.",
      "Can make simple, logical paragraph breaks in a longer text.",
    ],
    "B1+": [
      "Can introduce a counter-argument in a simple discursive text (e.g. with “however”).",
    ],
    "B2": [
      "Can use a limited number of cohesive devices to link their utterances into clear, coherent discourse, though there may be some “jumpiness” in a long contribution.",
      "Can produce text that is generally well-organised and coherent, using a range of linking expressions and cohesive devices.",
      "Can structure longer texts in clear, logical paragraphs.",
    ],
    "B2+": [
      "Can use a variety of linking expressions efficiently to mark clearly the relationships between ideas.",
    ],
  },
  "Grammatical accuracy": {
    "A1": [
      "Shows only limited control of a few simple grammatical structures and sentence patterns in a learnt repertoire.",
    ],
    "A2": [
      "Uses some simple structures correctly, but still systematically makes basic mistakes; nevertheless, it is usually clear what they are trying to say.",
    ],
    "B1": [
      "Uses reasonably accurately a repertoire of frequently used “routines” and patterns associated with more predictable situations.",
    ],
    "B1+": [
      "Communicates with reasonable accuracy in familiar contexts; generally good control, though with noticeable mother-tongue influence. Errors occur, but it is clear what they are trying to express.",
    ],
    "B2": [
      "Shows a relatively high degree of grammatical control. Does not make mistakes which lead to misunderstanding.",
      "Has a good command of simple language structures and some complex grammatical forms, although they tend to use complex structures rigidly with some inaccuracy.",
    ],
    "B2+": [
      "Good grammatical control; occasional “slips” or non-systematic errors and minor flaws in sentence structure may still occur, but they are rare and can often be corrected in retrospect.",
    ],
  },
  "General linguistic range": {
    "A1": [
      "Has a very basic range of simple expressions about personal details and needs of a concrete type.",
      "Can use some basic structures in one-clause sentences with some omission or reduction of elements.",
    ],
    "A2": [
      "Can produce brief, everyday expressions in order to satisfy simple needs of a concrete type (e.g. personal details, daily routines, wants and needs, requests for information).",
      "Can use basic sentence patterns and communicate with memorised phrases, groups of a few words and formulae about themselves and other people, what they do, places, possessions, etc.",
      "Has a limited repertoire of short, memorised phrases covering predictable survival situations; frequent breakdowns and misunderstandings occur in non-routine situations.",
    ],
    "A2+": [
      "Has a repertoire of basic language which enables them to deal with everyday situations with predictable content, though they will generally have to compromise the message and search for words.",
    ],
    "B1": [
      "Has enough language to get by, with sufficient vocabulary to express themselves with some hesitation and circumlocutions on topics such as family, hobbies and interests, work, travel and current events, but lexical limitations cause repetition and even difficulty with formulation at times.",
    ],
    "B1+": [
      "Has a sufficient range of language to describe unpredictable situations, explain the main points in an idea or problem with reasonable precision and express thoughts on abstract or cultural topics such as music and film.",
    ],
    "B2": [
      "Has a sufficient range of language to be able to give clear descriptions, express viewpoints and develop arguments without much conspicuous searching for words, using some complex sentence forms to do so.",
    ],
    "B2+": [
      "Can express themselves clearly without much sign of having to restrict what they want to say.",
    ],
  },
  "Vocabulary range": {
    "A1": [
      "Has a basic vocabulary repertoire of words and phrases related to particular concrete situations.",
    ],
    "A2": [
      "Has sufficient vocabulary for the expression of basic communicative needs.",
      "Has sufficient vocabulary for coping with simple survival needs.",
    ],
    "A2+": [
      "Has sufficient vocabulary to conduct routine everyday transactions involving familiar situations and topics.",
    ],
    "B1": [
      "Has a good range of vocabulary related to familiar topics and everyday situations.",
      "Has sufficient vocabulary to express themselves with some circumlocutions on most topics pertinent to their everyday life such as family, hobbies and interests, work, travel and current events.",
    ],
    "B2": [
      "Has a good range of vocabulary for matters connected to their field and most general topics.",
      "Can vary formulation to avoid frequent repetition, but lexical gaps can still cause hesitation and circumlocution.",
      "Can produce appropriate collocations of many words in most contexts fairly systematically.",
      "Can understand and use much of the specialist vocabulary of their field but has problems with specialist terminology outside it.",
    ],
    "B2+": [
      "Can understand and use the main technical terminology of their field, when discussing their area of specialisation with other specialists.",
    ],
  },
  "Vocabulary control": {
    "A2": [
      "Can control a narrow repertoire dealing with concrete, everyday needs.",
    ],
    "B1": [
      "Shows good control of elementary vocabulary but major errors still occur when expressing more complex thoughts or handling unfamiliar topics and situations.",
      "Uses a wide range of simple vocabulary appropriately when discussing familiar topics.",
    ],
    "B2": [
      "Lexical accuracy is generally high, though some confusion and incorrect word choice does occur without hindering communication.",
    ],
  },
};

// Which scales describe each kind of generation.
const SKILLS = {
  listening: ["Overall oral comprehension", "Understanding conversation between other people", "Understanding audio media and recordings"],
  reading: ["Overall reading comprehension"],
  writing: ["Overall written production", "Creative writing", "Coherence and cohesion", "Grammatical accuracy"],
  language: ["General linguistic range", "Vocabulary range", "Vocabulary control"],
};
export type Skill = keyof typeof SKILLS;

// The CEFR doesn't list grammar for any language, so this is the usual
// German course progression (as in the Goethe-Institut's level courses),
// to make the descriptors concrete.
const GRAMMAR: Record<string, string> = {
  A1: `present tense, Perfekt of everyday verbs, war/hatte, main clauses joined with und, aber, oder, questions with W-words. Avoid subordinate clauses, the passive, relative clauses, the genitive and Konjunktiv. Sentences of about 8 words at most.`,
  A2: `main clauses plus simple subordinate clauses with weil, dass, wenn, ob; Perfekt for the past, Präteritum only of sein, haben and modal verbs; modal verbs; separable verbs; würde/hätte/wäre for wishes and what-ifs; comparisons (größer als, am größten). Avoid the passive, relative clauses (at most one or two very simple ones), the genitive and genitive prepositions (trotz, während, statt), zu-infinitive constructions (um/ohne/statt … zu), Konjunktiv I, and abstract nouns on -ung/-heit/-keit unless explained. Sentences of mostly 12 words or fewer.`,
  B1: `everything from A2, plus relative clauses, zu-infinitives and um … zu, obwohl, damit, nachdem, Präteritum when telling a story, and the simple passive. Avoid long nested sentences, heavy nominal style (strings of abstract nouns) and Konjunktiv I. Sentences of mostly 15 words or fewer.`,
  B2: `the full range of natural German, including the passive, Konjunktiv II in the past and occasionally Konjunktiv I for reported speech.`,
};

export const cefrOf = (lvl: string): Cefr => {
  const base = lvl.slice(0, 2) as Cefr;
  return lvl.endsWith(".2") && base !== "A1" ? (`${base}+` as Cefr) : base;
};

// The official descriptors for `lvl` on the skills' scales, plus the German
// grammar that goes with the level.
export function levelGuide(lvl: string, skills: Skill[]) {
  const cefr = cefrOf(lvl);
  const levels: Cefr[] = cefr.endsWith("+") ? [cefr.slice(0, 2) as Cefr, cefr] : [cefr];
  const scales = skills.flatMap(s => SKILLS[s]).map(name => {
    const lines = levels.flatMap(l => SCALES[name][l] ?? []);
    return lines.length ? `- ${name}: ${lines.join(" ")}` : "";
  });
  return `The learner's level ${lvl} is CEFR ${cefr}. What a learner at ${cefr} can do (CEFR Companion Volume, Council of Europe 2020):
${scales.filter(Boolean).join("\n")}
German grammar at ${cefr.slice(0, 2)} (${lvl.endsWith(".1") ? "early in the level: stay at its simpler end" : "late in the level: use its full range"}): ${GRAMMAR[cefr.slice(0, 2)] ?? GRAMMAR.A2}`;
}
