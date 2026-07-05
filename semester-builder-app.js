(() => {
  // semester-builder-app.jsx
  var { useState, useMemo } = React;
  function Icon({ size = 16, color, children, ...rest }) {
    return /* @__PURE__ */ React.createElement(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: color || "currentColor",
        strokeWidth: "2",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        ...rest
      },
      children
    );
  }
  var Plus = (props) => /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "5", x2: "12", y2: "19" }), /* @__PURE__ */ React.createElement("line", { x1: "5", y1: "12", x2: "19", y2: "12" }));
  var X = (props) => /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("line", { x1: "18", y1: "6", x2: "6", y2: "18" }), /* @__PURE__ */ React.createElement("line", { x1: "6", y1: "6", x2: "18", y2: "18" }));
  var ChevronDown = (props) => /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("polyline", { points: "6 9 12 15 18 9" }));
  var Check = (props) => /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("polyline", { points: "20 6 9 17 4 12" }));
  var Search = (props) => /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("circle", { cx: "11", cy: "11", r: "8" }), /* @__PURE__ */ React.createElement("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" }));
  var Trash2 = (props) => /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("polyline", { points: "3 6 5 6 21 6" }), /* @__PURE__ */ React.createElement("path", { d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" }), /* @__PURE__ */ React.createElement("path", { d: "M10 11v6" }), /* @__PURE__ */ React.createElement("path", { d: "M14 11v6" }), /* @__PURE__ */ React.createElement("path", { d: "M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" }));
  var ExternalLink = (props) => /* @__PURE__ */ React.createElement(Icon, { ...props }, /* @__PURE__ */ React.createElement("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }), /* @__PURE__ */ React.createElement("polyline", { points: "15 3 21 3 21 9" }), /* @__PURE__ */ React.createElement("line", { x1: "10", y1: "14", x2: "21", y2: "3" }));
  var CATEGORIES = [
    { id: "majorCore", label: "Major \u2014 Core", group: "major", target: null, color: "#1E4FA0" },
    { id: "majorElective", label: "Major \u2014 Elective", group: "major", target: null, color: "#3E6FC4" },
    { id: "interfocus", label: "Inter-Focus", group: null, target: 16, color: "#7A4FA0" },
    { id: "practical", label: "Practical Work", group: null, target: 8, color: "#3F7A5C" },
    { id: "seminar", label: "Seminar", group: null, target: 2, color: "#8A8560" },
    { id: "sip", label: "Science in Perspective", group: null, target: 2, color: "#B5824A" },
    { id: "minor", label: "Minor", group: null, target: 18, color: "#A0527A" },
    { id: "elective", label: "Free Elective", group: null, target: 18, color: "#5C7A8A" },
    { id: "thesis", label: "Thesis", group: null, target: 30, color: "#14161A" }
  ];
  var MAJOR_TARGET = 26;
  var MAJOR_CORE_MIN = 16;
  var TOTAL_TARGET = 120;
  var STATUS_META = {
    confirmed: { label: "Confirmed HS2026", color: "#3F7A5C", bg: "#EAF2ED" },
    "not-offered": { label: "Not offered HS2026", color: "#B5433A", bg: "#FBECEA" },
    unverified: { label: "Verify on VVZ", color: "#C08A2E", bg: "#FBF2E3" },
    historical: { label: "FS2026 basis", color: "#5C7A8A", bg: "#EAF0F2" },
    flexible: { label: "Flexible / negotiate ECTS", color: "#1E4FA0", bg: "#EAF0FA" }
  };
  var vvzUrl = (id, semkez = "2026W") => `https://www.vvz.ethz.ch/Vorlesungsverzeichnis/lerneinheit.view?lerneinheitId=${id}&semkez=${semkez}&ansicht=ALLE&lang=en`;
  var CATALOG = [
    { code: "252-0463", name: "Security Engineering", ects: 7, category: "majorCore", term: "HS", status: "confirmed", vvzId: 202671 },
    { code: "252-1414", name: "System Security", ects: 7, category: "majorCore", term: "HS", status: "confirmed", vvzId: 204253 },
    { code: "263-4640", name: "Network Security", ects: 8, category: "majorCore", term: "HS", status: "confirmed", vvzId: 204555 },
    { code: "263-4658", name: "Privacy Enhancing Technologies", ects: 7, category: "majorCore", term: "HS", status: "confirmed", vvzId: 203996 },
    { code: "263-2800", name: "Design of Parallel and High-Performance Computing", ects: 9, category: "majorCore", term: "HS", status: "confirmed", vvzId: 202575 },
    { code: "252-0237", name: "Concepts of Object-Oriented Programming", ects: 8, category: "majorCore", term: "HS", status: "not-offered", note: 'Marked "does not take place" for HS2026 in VVZ.', vvzId: 203661 },
    { code: "227-0579", name: "Hardware Security", ects: 8, category: "majorElective", term: "HS", status: "confirmed", vvzId: 204091 },
    { code: "263-2520", name: "Formal Foundations of Programming Languages", ects: 7, category: "majorElective", term: "HS", status: "confirmed", vvzId: 202874 },
    { code: "263-2816", name: "Exploiting and Reasoning about Concurrency", ects: 6, category: "majorElective", term: "HS", status: "confirmed", note: "Was 5 ECTS in prior years; now 6 for 2026.", vvzId: 202500 },
    { code: "252-1411", name: "Security of Wireless Networks", ects: 6, category: "majorElective", term: "HS", status: "confirmed", vvzId: 203375 },
    { code: "263-2400", name: "Reliable and Trustworthy Artificial Intelligence", ects: 6, category: "majorElective", term: "HS", status: "confirmed", vvzId: 203746 },
    { code: "263-4665", name: "Zero-Knowledge Proofs", ects: 5, category: "majorElective", term: "HS", status: "confirmed", vvzId: 203251 },
    { code: "263-0009", name: "Information Security Lab", ects: 8, category: "interfocus", term: "HS", status: "confirmed", note: "Your autumn Inter-Focus anchor \u2014 only offered in HS.", vvzId: 202983 },
    { code: "263-0006", name: "Algorithms Lab", ects: 8, category: "interfocus", term: "HS", status: "confirmed", note: "You've excluded this one.", vvzId: 203184 },
    { code: "263-0008", name: "Computational Intelligence Lab", ects: 8, category: "interfocus", term: "FS", status: "historical", note: "Code/ECTS from the FS2026 offering, used as the working plan for FS2027 until the new catalogue opens.", vvzId: 197926, semkez: "2026S" },
    { code: "263-0007", name: "Advanced Systems Lab", ects: 8, category: "interfocus", term: "FS", status: "historical", note: "Code/ECTS from the FS2026 offering, used as the working plan for FS2027 until the new catalogue opens.", vvzId: 199826, semkez: "2026S" },
    /* Spring-semester SRS Major Core/Elective — confirmed directly from ETH's
       structured major page (thanks to the direct section links you found;
       my earlier keyword-search guesses had a couple of these miscategorized
       as Elective when they're actually Core, and one — Principles of
       Distributed Computing — isn't SRS Major at all, it's a Systems Software
       Minor course, moved down below). */
    { code: "263-2815", name: "Automated Software Testing", ects: 7, category: "majorCore", term: "FS", status: "confirmed", vvzId: 198365, semkez: "2026S" },
    { code: "263-4660", name: "Applied Cryptography", ects: 8, category: "majorCore", term: "FS", status: "confirmed", vvzId: 198098, semkez: "2026S" },
    { code: "252-0408", name: "Cryptographic Protocols", ects: 6, category: "majorElective", term: "FS", status: "confirmed", vvzId: 198946, semkez: "2026S" },
    { code: "263-2812", name: "Program Verification", ects: 5, category: "majorElective", term: "FS", status: "confirmed", note: "Formal-methods/PL course \u2014 closer to your stated interests than most on this list.", vvzId: 199656, semkez: "2026S" },
    { code: "263-4600", name: "Formal Methods for Information Security", ects: 5, category: "majorElective", term: "FS", status: "confirmed", vvzId: 199219, semkez: "2026S" },
    { code: "263-4656", name: "Digital Signatures", ects: 5, category: "majorElective", term: "FS", status: "confirmed", vvzId: 197738, semkez: "2026S" },
    { code: "252-0811", name: "Applied Security Laboratory", ects: 8, category: "practical", term: "HS", status: "confirmed", vvzId: 204155 },
    { code: "263-0650", name: "Practical Work", ects: 8, category: "practical", term: "HS/FS", status: "flexible", note: "ECTS scope is negotiated with your supervisor.", vvzId: 204550 },
    { code: "263-XXXX", name: "Master's Thesis", ects: 30, category: "thesis", term: "HS/FS", status: "flexible", note: "Registered once you begin the thesis \u2014 confirm the exact module code and timing with your program coordinator." },
    { code: "252-4601", name: "Current Topics in Information Security", ects: 2, category: "seminar", term: "HS", status: "confirmed", vvzId: 202790 },
    { code: "263-2100", name: "Research Topics in Software Engineering", ects: 2, category: "seminar", term: "HS/FS", status: "confirmed", note: "Confirmed offered in both HS2026 and FS2026 \u2014 runs every semester.", vvzId: 204225 },
    /* Minor — Systems Software (chosen). Confirmed directly from ETH's
       structured minor page for both semesters. System Security and Design
       of Parallel/HPC are on the minor's own list too, but they're already
       sitting in your SRS Major Core so aren't repeated here — can't double-
       count a course. */
    { code: "263-3845", name: "Data Management Systems", ects: 8, category: "minor", term: "HS", status: "confirmed", track: "Systems Software", vvzId: 204075 },
    { code: "227-0558", name: "Principles of Distributed Computing", ects: 7, category: "minor", term: "FS", status: "confirmed", track: "Systems Software", vvzId: 198389, semkez: "2026S" },
    { code: "263-3800", name: "Advanced Operating Systems", ects: 7, category: "minor", term: "FS", status: "confirmed", track: "Systems Software", note: "Roscoe/Baumann \u2014 squarely in your OS interest.", vvzId: 199676, semkez: "2026S" },
    { code: "227-0128", name: "Synthesis of Digital Circuits", ects: 6, category: "minor", term: "FS", status: "confirmed", track: "Systems Software", vvzId: 197793, semkez: "2026S" },
    /* Minor candidates — Theoretical Computer Science. 263-0006/263-0009/263-4658
       also appear on the TCS minor list but are already used elsewhere in your
       plan (Inter-Focus / Major Elective) so aren't repeated here. */
    { code: "227-0417", name: "Information Theory I", ects: 6, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 203897 },
    { code: "252-0535", name: "Advanced Machine Learning", ects: 10, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 203151 },
    { code: "252-1425", name: "Geometry: Combinatorics and Algorithms", ects: 8, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 204238 },
    { code: "261-5110", name: "Optimization for Data Science", ects: 10, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 202589 },
    { code: "263-4500", name: "Advanced Algorithms", ects: 9, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 202664 },
    { code: "263-4511", name: "Projects in Topological Data Analysis", ects: 4, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 203248 },
    { code: "263-4512", name: "Formalizing Analysis of Algorithms", ects: 4, category: "minor", term: "HS", status: "not-offered", note: "Not offered HS2026 per VVZ.", track: "Theoretical CS", vvzId: 206318 },
    { code: "401-3071", name: "Structural Graph Theory", ects: 5, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 204829 },
    { code: "263-5300", name: "Guarantees for Machine Learning", ects: 7, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 204713 },
    { code: "401-3054", name: "Probabilistic Methods in Combinatorics", ects: 5, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 204178 },
    { code: "401-3055", name: "Algebraic Methods in Combinatorics", ects: 5, category: "minor", term: "HS", status: "not-offered", note: "Not offered HS2026 per VVZ \u2014 check FS.", track: "Theoretical CS", vvzId: 204084 },
    { code: "401-3901", name: "Linear and Combinatorial Optimization", ects: 10, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 203698 },
    { code: "402-0448", name: "Quantum Information Processing I: Concepts", ects: 5, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 204490 },
    { code: "401-4944", name: "Mathematics of Data Science", ects: 8, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 204200 },
    { code: "252-0293", name: "Wireless Networking and Mobile Computing", ects: 4, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 203545 },
    { code: "263-0600", name: "Research in Computer Science", ects: 5, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", note: "Supervised research project, not a taught course.", vvzId: 202821 },
    { code: "252-2111", name: "Training for Programming Coaches", ects: 1, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 204211 },
    { code: "263-5053", name: "Technology Investing", ects: 3, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 203744 },
    { code: "263-5054", name: "Patenting Digital Innovations", ects: 1, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 204650 },
    { code: "263-5055", name: "Talent Kick: From Student to Entrepreneur", ects: 3, category: "minor", term: "HS", status: "confirmed", track: "Theoretical CS", vvzId: 204897 },
    /* Free Elective candidates — this is the general CS-Master "Elective Courses"
       pool, distinct from any major's own Core/Elective list. Pulled from the
       Spring 2026 catalogue (already underway now, before you even start — a
       proxy for what typically runs in spring, re-check the real 2027S
       catalogue closer to the time since lecturers/lists shift year to year).
       Advanced OS, Program Verification, Principles of Distributed Computing
       and Synthesis of Digital Circuits also show up in this general pool, but
       they're already tracked above under Major Elective / Systems Software
       Minor, so not repeated here — pick one category to count them under. */
    { code: "263-5352", name: "Advanced Formal Language Theory", ects: 6, category: "elective", term: "FS", status: "confirmed", note: "Framed for NLP rather than classic PL/compiler theory \u2014 check the syllabus before committing.", vvzId: 199534, semkez: "2026S" },
    { code: "401-3052-10L", name: "Graph Theory", ects: 9, category: "elective", term: "FS", status: "confirmed", note: "Theory-heavy, further from your stated interests but solid if you want rigor.", vvzId: 197875, semkez: "2026S" },
    { code: "401-3902-25L", name: "Discrete Optimization", ects: 9, category: "elective", term: "FS", status: "confirmed", note: "Theory-heavy, further from your stated interests but solid if you want rigor.", vvzId: 199885, semkez: "2026S" },
    { code: "272-0300-00L", name: "Algorithmics for Hard Problems", ects: 5, category: "elective", term: "FS", status: "not-offered", note: 'Marked "does not take place" for the Spring 2026 instance \u2014 check whether it returns for 2027S.', vvzId: 199292, semkez: "2026S" }
  ];
  var SEMESTER_DEFS = [
    { id: "s1", label: "Semester 1", term: "HS2026" },
    { id: "s2", label: "Semester 2", term: "FS2027" },
    { id: "s3", label: "Semester 3", term: "HS2027" },
    { id: "s4", label: "Semester 4", term: "FS2028" },
    { id: "s5", label: "Semester 5", term: "HS2028" }
  ];
  var STORAGE_KEYS = {
    plan: "semester-builder-plan",
    customCourses: "semester-builder-custom-courses"
  };
  var uid = () => Math.random().toString(36).slice(2, 10);
  var catLabel = (id) => {
    var _a, _b;
    return (_b = (_a = CATEGORIES.find((c) => c.id === id)) == null ? void 0 : _a.label) != null ? _b : id;
  };
  var catColor = (id) => {
    var _a, _b;
    return (_b = (_a = CATEGORIES.find((c) => c.id === id)) == null ? void 0 : _a.color) != null ? _b : "#666";
  };
  function useStorage(key, fallback) {
    const [data, setData] = useState(() => {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
      } catch {
        return fallback;
      }
    });
    const set = (updater) => {
      setData((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
        }
        return next;
      });
    };
    return [data, set];
  }
  function SemesterBuilderApp() {
    const [plan, setPlan] = useStorage(
      STORAGE_KEYS.plan,
      Object.fromEntries(SEMESTER_DEFS.map((s) => [s.id, []]))
    );
    const [customCourses, setCustomCourses] = useStorage(STORAGE_KEYS.customCourses, []);
    const [view, setView] = useState("overview");
    const [pickerSemester, setPickerSemester] = useState(null);
    const fullCatalog = useMemo(() => [...CATALOG, ...customCourses], [customCourses]);
    const allPlannedEntries = useMemo(
      () => SEMESTER_DEFS.flatMap((s) => plan[s.id].map((e) => ({ ...e, semesterId: s.id }))),
      [plan]
    );
    const plannedElsewhere = useMemo(() => {
      const map = /* @__PURE__ */ new Map();
      SEMESTER_DEFS.forEach((s) => {
        plan[s.id].forEach((c) => map.set(c.code + c.name, s.label));
      });
      return map;
    }, [plan]);
    const categoryTotals = useMemo(() => {
      const totals = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
      allPlannedEntries.forEach((e) => {
        if (totals[e.category] !== void 0) totals[e.category] += e.ects;
      });
      return totals;
    }, [allPlannedEntries]);
    const majorCoreTotal = categoryTotals.majorCore;
    const majorTotal = categoryTotals.majorCore + categoryTotals.majorElective;
    const grandTotal = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
    function addCourse(course, semesterId) {
      setPlan((p) => ({
        ...p,
        [semesterId]: [...p[semesterId], { ...course, planId: uid() }]
      }));
    }
    function removeCourse(semesterId, planId) {
      setPlan((p) => ({
        ...p,
        [semesterId]: p[semesterId].filter((c) => c.planId !== planId)
      }));
    }
    function addCustomCourse(course) {
      setCustomCourses((c) => [...c, { ...course, code: course.code || "CUSTOM" }]);
    }
    const semesterEctsSum = (id) => plan[id].reduce((a, c) => a + c.ects, 0);
    return /* @__PURE__ */ React.createElement("div", { className: "app-page", style: styles.page }, /* @__PURE__ */ React.createElement("style", null, fontFace), /* @__PURE__ */ React.createElement("style", null, responsiveCSS), /* @__PURE__ */ React.createElement("header", { className: "app-header", style: styles.header }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: styles.eyebrow }, "D-INFK \xB7 MSc Computer Science \xB7 SRS Major"), /* @__PURE__ */ React.createElement("h1", { style: styles.h1 }, "Degree Ledger")), /* @__PURE__ */ React.createElement("div", { className: "total-badge", style: styles.totalBadge }, /* @__PURE__ */ React.createElement("span", { style: styles.totalNum }, grandTotal), /* @__PURE__ */ React.createElement("span", { style: styles.totalDenom }, "/ ", TOTAL_TARGET, " ECTS"))), /* @__PURE__ */ React.createElement(DegreeOverview, { categoryTotals, majorTotal, majorCoreTotal }), /* @__PURE__ */ React.createElement("section", { style: styles.plannerSection }, /* @__PURE__ */ React.createElement("div", { className: "tab-row", style: styles.tabRow }, /* @__PURE__ */ React.createElement(
      "button",
      {
        onClick: () => setView("overview"),
        style: {
          ...styles.tab,
          ...view === "overview" ? styles.tabActive : {}
        }
      },
      /* @__PURE__ */ React.createElement("span", { style: styles.tabTerm }, "All years"),
      /* @__PURE__ */ React.createElement("span", { style: styles.tabLabel }, "Overview"),
      /* @__PURE__ */ React.createElement("span", { style: { ...styles.tabEcts, color: view === "overview" ? void 0 : "#8A877E" } }, grandTotal, " ECTS")
    ), SEMESTER_DEFS.map((s) => {
      const sum = semesterEctsSum(s.id);
      const flag = sum > 0 && (sum < 18 || sum > 25);
      return /* @__PURE__ */ React.createElement(
        "button",
        {
          key: s.id,
          onClick: () => setView(s.id),
          style: {
            ...styles.tab,
            ...view === s.id ? styles.tabActive : {}
          }
        },
        /* @__PURE__ */ React.createElement("span", { style: styles.tabTerm }, s.term),
        /* @__PURE__ */ React.createElement("span", { style: styles.tabLabel }, s.label),
        /* @__PURE__ */ React.createElement(
          "span",
          {
            style: {
              ...styles.tabEcts,
              color: flag ? "#C08A2E" : sum > 0 ? "#3F7A5C" : "#8A877E"
            }
          },
          sum,
          " ECTS"
        )
      );
    })), view === "overview" ? /* @__PURE__ */ React.createElement(
      OverviewPanel,
      {
        plan,
        semesterEctsSum,
        onRemove: (semesterId, planId) => removeCourse(semesterId, planId),
        onOpenPicker: (semesterId) => setPickerSemester(semesterId)
      }
    ) : /* @__PURE__ */ React.createElement(
      SemesterPanel,
      {
        semester: SEMESTER_DEFS.find((s) => s.id === view),
        courses: plan[view],
        onRemove: (planId) => removeCourse(view, planId),
        onOpenPicker: () => setPickerSemester(view)
      }
    )), pickerSemester && /* @__PURE__ */ React.createElement(
      CoursePicker,
      {
        catalog: fullCatalog,
        plannedElsewhere,
        season: SEMESTER_DEFS.find((s) => s.id === pickerSemester).term.startsWith("HS") ? "HS" : "FS",
        semesterLabel: SEMESTER_DEFS.find((s) => s.id === pickerSemester).label,
        onAdd: (course) => addCourse(course, pickerSemester),
        onAddCustom: (course) => {
          addCustomCourse(course);
          addCourse({ ...course, code: course.code || "CUSTOM" }, pickerSemester);
        },
        onClose: () => setPickerSemester(null)
      }
    ), /* @__PURE__ */ React.createElement("footer", { style: styles.footer }, `Data verified against the live ETH VVZ on 3 July 2026 for the courses shown above. Minor, Science-in-Perspective and Free-Elective slots are empty by default \u2014 use "Add custom course" once you've picked a Minor and checked coursereview.ch / VVZ yourself.`));
  }
  function DegreeOverview({ categoryTotals, majorTotal, majorCoreTotal }) {
    return /* @__PURE__ */ React.createElement("section", { style: styles.overview }, /* @__PURE__ */ React.createElement(
      LedgerRow,
      {
        label: "Major (Core + Elective)",
        value: majorTotal,
        target: MAJOR_TARGET,
        color: "#1E4FA0",
        sub: /* @__PURE__ */ React.createElement("span", { style: { color: majorCoreTotal >= MAJOR_CORE_MIN ? "#3F7A5C" : "#B5433A" } }, majorCoreTotal, " / ", MAJOR_CORE_MIN, " min. from Core")
      }
    ), CATEGORIES.filter((c) => !c.group).map((c) => /* @__PURE__ */ React.createElement(
      LedgerRow,
      {
        key: c.id,
        label: c.label,
        value: categoryTotals[c.id],
        target: c.target,
        color: c.color
      }
    )));
  }
  function LedgerRow({ label, value, target, color, sub }) {
    const pct = target ? Math.min(100, value / target * 100) : 0;
    const over = target && value > target;
    return /* @__PURE__ */ React.createElement("div", { className: "ledger-row", style: styles.ledgerRow }, /* @__PURE__ */ React.createElement("div", { className: "ledger-label-col", style: styles.ledgerLabelCol }, /* @__PURE__ */ React.createElement("div", { style: styles.ledgerLabel }, label), sub && /* @__PURE__ */ React.createElement("div", { style: styles.ledgerSub }, sub)), /* @__PURE__ */ React.createElement("div", { className: "ledger-track", style: styles.ledgerTrack }, /* @__PURE__ */ React.createElement(
      "div",
      {
        style: {
          ...styles.ledgerFill,
          width: `${pct}%`,
          background: over ? "#C08A2E" : color
        }
      }
    )), /* @__PURE__ */ React.createElement("div", { className: "ledger-num", style: styles.ledgerNum }, value, " ", /* @__PURE__ */ React.createElement("span", { style: styles.ledgerNumDenom }, "/ ", target != null ? target : "\u2014")));
  }
  function SemesterPanel({ semester, courses, onRemove, onOpenPicker }) {
    const sum = courses.reduce((a, c) => a + c.ects, 0);
    const loadNote = sum === 0 ? null : sum < 18 ? "Light load \u2014 fine if intentional, otherwise room to add more." : sum > 25 ? "Heavy load for a 5-semester pace \u2014 consider moving something out." : "Within your usual 20\u201323 ECTS target.";
    return /* @__PURE__ */ React.createElement("div", { style: styles.panel }, /* @__PURE__ */ React.createElement("div", { style: styles.panelHead }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: styles.panelTerm }, semester.term), /* @__PURE__ */ React.createElement("div", { style: styles.panelSum }, sum, " ECTS", loadNote ? /* @__PURE__ */ React.createElement("span", { style: styles.panelNote }, " \u2014 ", loadNote) : null)), /* @__PURE__ */ React.createElement("button", { style: styles.addBtn, onClick: onOpenPicker }, /* @__PURE__ */ React.createElement(Plus, { size: 15 }), " Add course")), courses.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: styles.emptyState }, "No courses added yet for ", semester.term, ".") : /* @__PURE__ */ React.createElement("div", { style: styles.courseList }, courses.map((c) => /* @__PURE__ */ React.createElement(CourseCard, { key: c.planId, course: c, onRemove: () => onRemove(c.planId) }))));
  }
  function OverviewPanel({ plan, semesterEctsSum, onRemove, onOpenPicker }) {
    return /* @__PURE__ */ React.createElement("div", { className: "overview-grid", style: styles.overviewGrid }, SEMESTER_DEFS.map((s) => {
      const courses = plan[s.id];
      const sum = semesterEctsSum(s.id);
      return /* @__PURE__ */ React.createElement("div", { key: s.id, style: styles.panel }, /* @__PURE__ */ React.createElement("div", { style: styles.panelHead }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: styles.panelTerm }, s.term), /* @__PURE__ */ React.createElement("div", { style: styles.panelSum }, s.label, " \u2014 ", sum, " ECTS")), /* @__PURE__ */ React.createElement("button", { style: styles.addBtn, onClick: () => onOpenPicker(s.id) }, /* @__PURE__ */ React.createElement(Plus, { size: 15 }), " Add course")), courses.length === 0 ? /* @__PURE__ */ React.createElement("div", { style: styles.emptyState }, "No courses added yet for ", s.term, ".") : /* @__PURE__ */ React.createElement("div", { style: styles.courseList }, courses.map((c) => /* @__PURE__ */ React.createElement(CourseCard, { key: c.planId, course: c, onRemove: () => onRemove(s.id, c.planId) }))));
    }));
  }
  function CourseCard({ course, onRemove, showTerm }) {
    const meta = STATUS_META[course.status];
    return /* @__PURE__ */ React.createElement("div", { className: "course-card" }, /* @__PURE__ */ React.createElement("div", { className: "course-card-top" }, /* @__PURE__ */ React.createElement("span", { className: "course-card-name" }, course.name), /* @__PURE__ */ React.createElement("span", { className: "course-card-ects" }, course.ects, " ECTS"), onRemove && /* @__PURE__ */ React.createElement("button", { className: "remove-btn", onClick: onRemove, "aria-label": `Remove ${course.name}` }, /* @__PURE__ */ React.createElement(Trash2, { size: 14 }))), /* @__PURE__ */ React.createElement("div", { className: "course-card-bottom" }, course.vvzId ? /* @__PURE__ */ React.createElement(
      "a",
      {
        className: "course-card-code course-card-link",
        href: vvzUrl(course.vvzId, course.semkez),
        target: "_blank",
        rel: "noopener noreferrer",
        onClick: (e) => e.stopPropagation(),
        title: "Open in ETH VVZ"
      },
      course.code,
      " ",
      /* @__PURE__ */ React.createElement(ExternalLink, { size: 10 })
    ) : /* @__PURE__ */ React.createElement("span", { className: "course-card-code" }, course.code), /* @__PURE__ */ React.createElement("span", { style: { ...styles.pill, color: catColor(course.category), borderColor: catColor(course.category) } }, catLabel(course.category)), meta && /* @__PURE__ */ React.createElement("span", { style: { ...styles.pill, color: meta.color, background: meta.bg, borderColor: "transparent" } }, meta.label), course.track && /* @__PURE__ */ React.createElement("span", { style: styles.termTag }, course.track), showTerm && /* @__PURE__ */ React.createElement("span", { style: styles.termTag }, course.term)), course.note && /* @__PURE__ */ React.createElement("div", { style: styles.courseNoteText }, course.note));
  }
  function CoursePicker({ catalog, plannedElsewhere, season, semesterLabel, onAdd, onAddCustom, onClose }) {
    const [query, setQuery] = useState("");
    const [filterCat, setFilterCat] = useState("all");
    const [showCustom, setShowCustom] = useState(false);
    const [showAllTerms, setShowAllTerms] = useState(false);
    const matchesSeason = (c) => showAllTerms || !season || c.term === season || c.term === "HS/FS" || c.term === "\u2014";
    const filtered = catalog.filter((c) => {
      if (filterCat !== "all" && c.category !== filterCat) return false;
      if (!matchesSeason(c)) return false;
      const q = query.toLowerCase();
      return !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q);
    });
    const hiddenOtherSeasonCount = catalog.filter((c) => !matchesSeason(c)).length;
    return /* @__PURE__ */ React.createElement("div", { className: "modal-overlay", style: styles.modalOverlay, onClick: onClose }, /* @__PURE__ */ React.createElement("div", { className: "modal", style: styles.modal, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement("div", { style: styles.modalHead }, /* @__PURE__ */ React.createElement("h2", { style: styles.modalTitle }, "Add a course to ", semesterLabel, season && /* @__PURE__ */ React.createElement("span", { style: styles.modalSubtitle }, " \u2014 ", season, " only")), /* @__PURE__ */ React.createElement("button", { style: styles.iconBtn, onClick: onClose }, /* @__PURE__ */ React.createElement(X, { size: 18 }))), /* @__PURE__ */ React.createElement("div", { className: "modal-controls", style: styles.modalControls }, /* @__PURE__ */ React.createElement("div", { style: styles.searchBox }, /* @__PURE__ */ React.createElement(Search, { size: 14, color: "#8A877E" }), /* @__PURE__ */ React.createElement(
      "input",
      {
        autoFocus: true,
        placeholder: "Search by name or code\u2026",
        value: query,
        onChange: (e) => setQuery(e.target.value),
        style: styles.searchInput
      }
    )), /* @__PURE__ */ React.createElement("select", { value: filterCat, onChange: (e) => setFilterCat(e.target.value), style: styles.select }, /* @__PURE__ */ React.createElement("option", { value: "all" }, "All categories"), CATEGORIES.map((c) => /* @__PURE__ */ React.createElement("option", { key: c.id, value: c.id }, c.label)))), /* @__PURE__ */ React.createElement("div", { style: styles.modalList }, filtered.length === 0 && /* @__PURE__ */ React.createElement("div", { style: styles.emptyState }, 'No matches. Try "Add a custom course" below.'), filtered.map((c) => {
      const takenIn = plannedElsewhere.get(c.code + c.name);
      if (!takenIn) {
        return /* @__PURE__ */ React.createElement(
          "div",
          {
            key: c.code + c.name,
            className: "course-card-button",
            role: "button",
            tabIndex: 0,
            onClick: () => {
              onAdd(c);
              onClose();
            },
            onKeyDown: (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onAdd(c);
                onClose();
              }
            }
          },
          /* @__PURE__ */ React.createElement(CourseCard, { course: c, showTerm: true })
        );
      }
      return /* @__PURE__ */ React.createElement("div", { key: c.code + c.name, className: "course-card-disabled", "aria-disabled": "true", title: `Already added to ${takenIn}` }, /* @__PURE__ */ React.createElement(CourseCard, { course: c, showTerm: true }), /* @__PURE__ */ React.createElement("div", { style: styles.takenNote }, "Already added to ", takenIn));
    })), /* @__PURE__ */ React.createElement("div", { style: styles.customToggleRow }, hiddenOtherSeasonCount > 0 && !showAllTerms && /* @__PURE__ */ React.createElement("button", { style: { ...styles.linkBtn, marginBottom: 8 }, onClick: () => setShowAllTerms(true) }, /* @__PURE__ */ React.createElement(ChevronDown, { size: 14 }), " Show ", hiddenOtherSeasonCount, " course", hiddenOtherSeasonCount === 1 ? "" : "s", " from the other semester too"), /* @__PURE__ */ React.createElement("button", { style: styles.linkBtn, onClick: () => setShowCustom((v) => !v) }, showCustom ? /* @__PURE__ */ React.createElement(ChevronDown, { size: 14 }) : /* @__PURE__ */ React.createElement(Plus, { size: 14 }), " Add a custom course")), showCustom && /* @__PURE__ */ React.createElement(
      CustomCourseForm,
      {
        onSubmit: (course) => {
          onAddCustom(course);
          onClose();
        }
      }
    )));
  }
  function CustomCourseForm({ onSubmit }) {
    const [name, setName] = useState("");
    const [code, setCode] = useState("");
    const [ects, setEcts] = useState(4);
    const [category, setCategory] = useState("minor");
    const canSubmit = name.trim().length > 0 && ects > 0;
    return /* @__PURE__ */ React.createElement("div", { style: styles.customForm }, /* @__PURE__ */ React.createElement(
      "input",
      {
        placeholder: "Course name (e.g. Compiler Design)",
        value: name,
        onChange: (e) => setName(e.target.value),
        style: styles.formInput
      }
    ), /* @__PURE__ */ React.createElement("div", { style: styles.formRow }, /* @__PURE__ */ React.createElement(
      "input",
      {
        placeholder: "Course code (optional)",
        value: code,
        onChange: (e) => setCode(e.target.value),
        style: { ...styles.formInput, flex: 1 }
      }
    ), /* @__PURE__ */ React.createElement(
      "input",
      {
        type: "number",
        min: 1,
        max: 12,
        value: ects,
        onChange: (e) => setEcts(Number(e.target.value)),
        style: { ...styles.formInput, width: 72 }
      }
    ), /* @__PURE__ */ React.createElement("select", { value: category, onChange: (e) => setCategory(e.target.value), style: { ...styles.select, flex: 1 } }, CATEGORIES.map((c) => /* @__PURE__ */ React.createElement("option", { key: c.id, value: c.id }, c.label)))), /* @__PURE__ */ React.createElement(
      "button",
      {
        disabled: !canSubmit,
        style: { ...styles.addBtn, opacity: canSubmit ? 1 : 0.4, alignSelf: "flex-start" },
        onClick: () => canSubmit && onSubmit({ name: name.trim(), code: code.trim(), ects, category, term: "\u2014", status: "unverified" })
      },
      /* @__PURE__ */ React.createElement(Check, { size: 15 }),
      " Save & add to semester"
    ));
  }
  var fontFace = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap');
`;
  var responsiveCSS = `
  * { box-sizing: border-box; }

  .app-page { padding: 16px 12px 40px; }
  @media (min-width: 640px) { .app-page { padding: 28px 20px 60px; } }

  .app-header { flex-direction: column; align-items: flex-start; gap: 10px; }
  .app-header .total-badge { text-align: left; }
  @media (min-width: 480px) {
    .app-header { flex-direction: row; align-items: flex-end; }
    .app-header .total-badge { text-align: right; }
  }

  .ledger-row {
    grid-template-columns: 1fr auto;
    grid-template-areas: "label num" "track track";
    row-gap: 6px;
    column-gap: 10px;
  }
  .ledger-row .ledger-label-col { grid-area: label; }
  .ledger-row .ledger-num { grid-area: num; }
  .ledger-row .ledger-track { grid-area: track; }
  @media (min-width: 560px) {
    .ledger-row {
      grid-template-columns: 180px 1fr 90px;
      grid-template-areas: "label track num";
      gap: 14px;
    }
  }

  .tab-row {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    padding-bottom: 4px;
    margin-left: -12px;
    margin-right: -12px;
    padding-left: 12px;
    padding-right: 12px;
  }
  @media (min-width: 640px) {
    .tab-row { flex-wrap: wrap; margin: 0; padding: 0 0 4px; }
  }

  .course-card {
    border: 1px solid #EFEDE5;
    border-radius: 8px;
    padding: 9px 11px;
  }
  .course-card-top {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .course-card-name {
    font-size: 13px;
    font-weight: 500;
    flex: 1;
    min-width: 0;
    text-align: left;
  }
  .course-card-ects {
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .course-card-bottom {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 5px;
  }
  .course-card-code {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10.5px;
    color: #8A877E;
    margin-right: 2px;
  }
  .course-card-link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    text-decoration: none;
    border-bottom: 1px dotted #1E4FA0;
    color: #1E4FA0 !important;
  }
  .course-card-link:hover { color: #14356E !important; }
  .course-card-button {
    display: block;
    width: 100%;
    cursor: pointer;
  }
  .course-card-button:focus-visible {
    outline: 2px solid #1E4FA0;
    outline-offset: 2px;
    border-radius: 8px;
  }
  .course-card-button:hover .course-card,
  .course-card-button:focus-visible .course-card {
    border-color: #1E4FA0;
    background: #F7F9FD;
  }
  .course-card-disabled {
    opacity: 0.45;
    pointer-events: none;
    user-select: none;
  }
  .overview-grid {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .remove-btn {
    background: none;
    border: none;
    color: #B5433A;
    cursor: pointer;
    padding: 2px;
    flex-shrink: 0;
    display: flex;
  }

  .modal-overlay { align-items: flex-end; padding: 0; }
  .modal { width: 100%; max-width: 100%; max-height: 88vh; border-radius: 16px 16px 0 0; }
  @media (min-width: 560px) {
    .modal-overlay { align-items: center; padding: 20px; }
    .modal { max-width: 560px; max-height: 82vh; border-radius: 12px; }
  }

  .modal-controls { flex-direction: column; }
  @media (min-width: 480px) { .modal-controls { flex-direction: row; } }

  input, select, button { font-size: 16px; }
  @media (min-width: 480px) {
    .modal-controls input, .modal-controls select { font-size: 13px; }
  }
`;
  var styles = {
    page: {
      fontFamily: "'Inter', system-ui, sans-serif",
      background: "#F5F4F0",
      color: "#14161A",
      minHeight: "100vh",
      padding: "28px 20px 60px",
      maxWidth: 880,
      margin: "0 auto"
    },
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "flex-end",
      marginBottom: 24,
      borderBottom: "2px solid #14161A",
      paddingBottom: 16
    },
    eyebrow: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 11,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: "#8A877E",
      marginBottom: 4
    },
    h1: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 28,
      fontWeight: 700,
      letterSpacing: "-0.01em",
      margin: 0
    },
    totalBadge: {
      fontFamily: "'JetBrains Mono', monospace",
      textAlign: "right"
    },
    totalNum: { fontSize: 30, fontWeight: 700 },
    totalDenom: { fontSize: 13, color: "#8A877E", marginLeft: 4 },
    overview: {
      background: "#FFFFFF",
      border: "1px solid #E1DFD6",
      borderRadius: 10,
      padding: "18px 20px",
      marginBottom: 28
    },
    ledgerRow: {
      display: "grid",
      alignItems: "center",
      padding: "9px 0",
      borderBottom: "1px solid #EFEDE5"
    },
    ledgerLabelCol: { display: "flex", flexDirection: "column" },
    ledgerLabel: { fontSize: 13.5, fontWeight: 500 },
    ledgerSub: { fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, marginTop: 2 },
    ledgerTrack: {
      height: 8,
      background: "#EFEDE5",
      borderRadius: 4,
      overflow: "hidden"
    },
    ledgerFill: { height: "100%", borderRadius: 4, transition: "width 0.3s ease" },
    ledgerNum: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 13,
      textAlign: "right",
      fontWeight: 600
    },
    ledgerNumDenom: { color: "#8A877E", fontWeight: 400 },
    plannerSection: { marginBottom: 20 },
    tabRow: { display: "flex", gap: 8, marginBottom: 14 },
    tab: {
      fontFamily: "'JetBrains Mono', monospace",
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 2,
      padding: "8px 14px",
      background: "#FFFFFF",
      border: "1px solid #E1DFD6",
      borderRadius: 8,
      cursor: "pointer",
      minWidth: 108,
      flexShrink: 0
    },
    tabActive: { border: "1px solid #14161A", background: "#14161A", color: "#F5F4F0" },
    tabTerm: { fontSize: 12, fontWeight: 700 },
    tabLabel: { fontSize: 10, opacity: 0.7 },
    tabEcts: { fontSize: 11, fontWeight: 600 },
    panel: {
      background: "#FFFFFF",
      border: "1px solid #E1DFD6",
      borderRadius: 10,
      padding: 20
    },
    panelHead: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14
    },
    panelTerm: { fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15 },
    panelSum: { fontSize: 12.5, color: "#5A574E", marginTop: 2 },
    panelNote: { color: "#C08A2E" },
    addBtn: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12.5,
      fontWeight: 600,
      background: "#1E4FA0",
      color: "#fff",
      border: "none",
      borderRadius: 7,
      padding: "8px 14px",
      cursor: "pointer"
    },
    emptyState: {
      padding: "24px 0",
      textAlign: "center",
      color: "#8A877E",
      fontSize: 13
    },
    courseList: { display: "flex", flexDirection: "column", gap: 8 },
    overviewGrid: { display: "flex", flexDirection: "column", gap: 16 },
    takenNote: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10.5,
      color: "#B5433A",
      padding: "0 11px 8px",
      marginTop: -4
    },
    courseNoteText: { fontSize: 11.5, color: "#8A877E", marginTop: 4, fontStyle: "italic" },
    pill: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
      padding: "2px 7px",
      borderRadius: 20,
      border: "1px solid"
    },
    termTag: {
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 10,
      color: "#8A877E"
    },
    footer: {
      marginTop: 36,
      fontSize: 11.5,
      color: "#8A877E",
      lineHeight: 1.5,
      borderTop: "1px solid #E1DFD6",
      paddingTop: 14
    },
    modalOverlay: {
      position: "fixed",
      inset: 0,
      background: "rgba(20,22,26,0.5)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      zIndex: 50
    },
    modal: {
      background: "#FFFFFF",
      borderRadius: 12,
      width: "100%",
      maxWidth: 560,
      maxHeight: "82vh",
      display: "flex",
      flexDirection: "column",
      padding: 20
    },
    modalHead: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
    modalTitle: { fontFamily: "'JetBrains Mono', monospace", fontSize: 17, margin: 0 },
    modalSubtitle: { fontSize: 12, fontWeight: 400, color: "#8A877E" },
    iconBtn: { background: "none", border: "none", cursor: "pointer", color: "#14161A" },
    modalControls: { display: "flex", gap: 8, marginBottom: 12 },
    searchBox: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      gap: 8,
      border: "1px solid #E1DFD6",
      borderRadius: 8,
      padding: "8px 12px"
    },
    searchInput: { border: "none", outline: "none", fontSize: 13, flex: 1, fontFamily: "'Inter', sans-serif" },
    select: {
      border: "1px solid #E1DFD6",
      borderRadius: 8,
      padding: "8px 10px",
      fontSize: 12.5,
      fontFamily: "'Inter', sans-serif",
      background: "#fff"
    },
    modalList: { overflowY: "auto", display: "flex", flexDirection: "column", gap: 6, paddingRight: 4 },
    customToggleRow: { marginTop: 14, borderTop: "1px solid #EFEDE5", paddingTop: 12 },
    linkBtn: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      background: "none",
      border: "none",
      color: "#1E4FA0",
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: 12.5,
      fontWeight: 600,
      cursor: "pointer",
      padding: 0
    },
    customForm: { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 },
    formInput: {
      border: "1px solid #E1DFD6",
      borderRadius: 8,
      padding: "8px 10px",
      fontSize: 13,
      fontFamily: "'Inter', sans-serif"
    },
    formRow: { display: "flex", gap: 8 }
  };
  ReactDOM.createRoot(document.getElementById("app")).render(/* @__PURE__ */ React.createElement(SemesterBuilderApp, null));
})();
