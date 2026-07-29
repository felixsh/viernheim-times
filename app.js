const DATA_URL = "trialogevent_results_2023_2025.csv";

const metrics = {
  total: { column: "Totalzeit", label: "Total time", color: "#e885bf" },
  swim: { column: "Schwimmen", label: "Swim", color: "#00bee5" },
  t1: { column: "Wechsel_1", label: "Transition 1", color: "#de9c31" },
  bike: { column: "Rad", label: "Bike", color: "#62c37a" },
  t2: { column: "Wechsel_2", label: "Transition 2", color: "#f68675" },
  run: { column: "Lauf", label: "Run", color: "#a29dfc" },
};

const athleteNameCollator = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});
const raceStatusOrder = ["DNS", "DNF", "DSQ"];
const urlStateKeys = ["tab", "year", "gender", "age"];
const filterDefaults = {
  charts: { year: "all", gender: "all", age: "all" },
  results: { year: "all", gender: "all", age: "all" },
};

const state = {
  rows: [],
  view: "charts",
  year: "all",
  gender: "all",
  age: "all",
  table: {
    year: "all",
    gender: "all",
    age: "all",
    sortKey: "place",
    sortDirection: "asc",
    selectedKey: null,
  },
};

const controls = {
  year: document.querySelector("#chart-year-toggle"),
  gender: document.querySelector("#chart-gender-toggle"),
  age: document.querySelector("#chart-age-filter"),
  reset: document.querySelector("#reset-filters"),
  tableYear: document.querySelector("#table-year-toggle"),
  tableGender: document.querySelector("#table-gender-toggle"),
  tableAge: document.querySelector("#table-age-filter"),
  tableReset: document.querySelector("#reset-table-filters"),
};

const tooltip = document.querySelector("#chart-tooltip");
let activeTooltipBar = null;
let pinnedTooltip = null;
let resizeTimer;
let syncResultsHeader = () => {};

function clearChartTooltip() {
  activeTooltipBar?.classList.remove("is-active");
  pinnedTooltip?.bar.classList.remove("is-active");
  activeTooltipBar = null;
  pinnedTooltip = null;
  tooltip.hidden = true;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && quoted && nextCharacter === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? "").trim()])),
  );
}

function parseTime(value) {
  if (!value) {
    return null;
  }

  const parts = value.split(":").map(Number);
  if (parts.some(Number.isNaN)) {
    return null;
  }
  if (parts.length === 1) {
    return parts[0];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

function normalizeAgeGroup(value) {
  const cleaned = value.trim().toUpperCase();
  if (!cleaned) {
    return "Unknown";
  }
  if (cleaned === "JUN") {
    return "Junior";
  }

  const rangeMatch = cleaned.match(/(\d{2})\s*-\s*(\d{2})/);
  if (rangeMatch) {
    return `${rangeMatch[1]}–${rangeMatch[2]}`;
  }

  const ageMatch = cleaned.match(/(\d{2})/);
  if (!ageMatch) {
    return cleaned;
  }

  const start = Number(ageMatch[1]);
  if (start >= 75) {
    return "75+";
  }
  if (start < 20) {
    return "18–19";
  }
  return `${start}–${start + 4}`;
}

function prepareRows(rawRows) {
  return rawRows.map((row) => ({
    year: row.Year,
    place: row.Platz,
    bib: row.Startnummer,
    name: row.Name,
    club: row.Verein,
    gender: row.Gender.toLowerCase(),
    age: normalizeAgeGroup(row.Altersklasse),
    times: Object.fromEntries(
      Object.entries(metrics).map(([key, metric]) => [key, parseTime(row[metric.column])]),
    ),
    timeLabels: Object.fromEntries(
      Object.entries(metrics).map(([key, metric]) => [key, row[metric.column]]),
    ),
  }));
}

function numericSort(left, right) {
  const leftNumber = Number.parseInt(left, 10);
  const rightNumber = Number.parseInt(right, 10);
  if (Number.isNaN(leftNumber) || Number.isNaN(rightNumber)) {
    return left.localeCompare(right);
  }
  return leftNumber - rightNumber;
}

function addOptions(select, values, labelFormatter = (value) => value) {
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = labelFormatter(value);
    select.append(option);
  });
}

function formatGender(gender) {
  const labels = { female: "Women", male: "Men", mixed: "Mixed", nonbinary: "Non-binary" };
  return labels[gender] ?? gender;
}

function formatRaceGroup(row) {
  const genderCode = row.gender === "female" ? "W" : row.gender === "male" ? "M" : "X";
  const ageNumber = row.age.match(/\d+/);
  return `${genderCode}${ageNumber ? ageNumber[0] : row.age}`;
}

function addToggleOptions(container, values, labelFormatter = (value) => value) {
  values.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.value = value;
    button.setAttribute("aria-pressed", "false");
    button.textContent = labelFormatter(value);
    container.append(button);
  });
}

function populateFilters() {
  const years = [...new Set(state.rows.map((row) => row.year))].sort();
  const genders = [...new Set(state.rows.map((row) => row.gender))].sort();
  const ageGroups = [...new Set(state.rows.map((row) => row.age))]
    .filter((age) => age !== "Unknown" && age !== "Junior")
    .sort(numericSort);

  addOptions(controls.age, ageGroups);
  addToggleOptions(controls.year, years);
  setToggleValue(controls.year, state.year);
  addToggleOptions(controls.gender, genders, formatGender);
  setToggleValue(controls.gender, state.gender);
  addOptions(controls.tableAge, ageGroups);
  addToggleOptions(controls.tableYear, years);
  filterDefaults.results.year = years.at(-1) ?? "all";
  state.table.year = filterDefaults.results.year;
  setToggleValue(controls.tableYear, state.table.year);
  addToggleOptions(controls.tableGender, genders, formatGender);
  setToggleValue(controls.tableGender, state.table.gender);
}

function quantile(sortedValues, position) {
  if (!sortedValues.length) {
    return null;
  }
  const index = (sortedValues.length - 1) * position;
  const lower = Math.floor(index);
  const fraction = index - lower;
  const next = sortedValues[lower + 1];
  return next === undefined
    ? sortedValues[lower]
    : sortedValues[lower] + fraction * (next - sortedValues[lower]);
}

function valuesFor(rows, metric) {
  return rows
    .map((row) => row.times[metric])
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
}

function formatTime(seconds, compact = false) {
  if (!Number.isFinite(seconds)) {
    return "—";
  }

  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  const paddedSeconds = String(remainingSeconds).padStart(2, "0");

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  if (compact && minutes === 0) {
    return `${remainingSeconds}s`;
  }
  return `${minutes}:${paddedSeconds}`;
}

function formatTableTime(value) {
  return value ? value.replace(/^0(?=\d:)/, "") : "—";
}

function formatPerformance(metric, seconds) {
  if (!Number.isFinite(seconds)) {
    return null;
  }
  if (metric === "swim") {
    return `${formatTime(seconds / 15)} /100 m`;
  }
  if (metric === "bike") {
    return `${(37.4 * 3600 / seconds).toFixed(1)} km/h`;
  }
  if (metric === "run") {
    return `${formatTime(seconds / 10)} /km`;
  }
  return null;
}

function filteredRows() {
  return state.rows.filter(
    (row) =>
      (state.year === "all" || row.year === state.year)
      && (state.gender === "all" || row.gender === state.gender)
      && (state.age === "all" || row.age === state.age),
  );
}

function updateSummary(rows) {
  const completed = valuesFor(rows, "total");
  const summaryMetrics = {
    total: valuesFor(rows, "total"),
    swim: valuesFor(rows, "swim"),
    bike: valuesFor(rows, "bike"),
    run: valuesFor(rows, "run"),
  };

  document.querySelector("#stat-finishers").textContent = completed.length.toLocaleString();
  document.querySelector("#stat-finishers-note").textContent =
    completed.length === rows.length ? "with recorded results" : `from ${rows.length} selected athletes`;

  Object.entries(summaryMetrics).forEach(([metric, values]) => {
    const median = quantile(values, 0.5);
    document.querySelector(`#stat-${metric}`).textContent = formatTime(median);
    const performance = formatPerformance(metric, median);
    if (metric !== "total") {
      document.querySelector(`#stat-${metric}-performance`).textContent = performance ?? "No recorded split";
    }
  });
}

function describeFilters() {
  const labels = [];
  if (state.year !== "all") {
    labels.push(state.year);
  }
  if (state.gender !== "all") {
    labels.push(formatGender(state.gender));
  }
  if (state.age !== "all") {
    labels.push(`age ${state.age}`);
  }
  return labels.length ? labels.join(" · ") : "All years, genders, and age groups";
}

function buildHistogram(values, availableWidth, metric) {
  const quantum = metric === "t1" || metric === "t2" ? 10 : 60;
  const observedMinimum = values[0];
  const observedMaximum = values.at(-1);
  const minimum = Math.floor(observedMinimum / quantum) * quantum;
  const alignedMaximum = Math.ceil(observedMaximum / quantum) * quantum;
  const initialMaximum = alignedMaximum > minimum ? alignedMaximum : minimum + quantum;
  const initialSpread = initialMaximum - minimum;
  const interquartileRange = quantile(values, 0.75) - quantile(values, 0.25);
  const freedmanDiaconisWidth = 2 * interquartileRange * values.length ** (-1 / 3);
  const sturgesBins = Math.ceil(Math.log2(values.length) + 1);
  const fallbackWidth = initialSpread / Math.max(sturgesBins * 2, 1);
  const targetWidth = (freedmanDiaconisWidth > 0 ? freedmanDiaconisWidth : fallbackWidth) / 2;
  const widthLimit = Math.max(8, Math.min(Math.floor(availableWidth / 14), 60));
  const minimumWidthForScreen = Math.ceil(initialSpread / widthLimit / quantum) * quantum;
  const snappedTargetWidth = Math.max(quantum, Math.round(targetWidth / quantum) * quantum);
  const binWidth = Math.max(snappedTargetWidth, minimumWidthForScreen);
  const binCount = Math.max(1, Math.ceil(initialSpread / binWidth));
  const maximum = minimum + binCount * binWidth;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: minimum + index * binWidth,
    end: minimum + (index + 1) * binWidth,
    count: 0,
  }));

  values.forEach((value) => {
    const index = Math.min(Math.floor((value - minimum) / binWidth), binCount - 1);
    bins[index].count += 1;
  });

  return { bins, minimum, maximum };
}

function niceCountMaximum(value) {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
  const normalized = value / magnitude;
  const niceValue = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceValue * magnitude;
}

function createSVGElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([attribute, value]) => element.setAttribute(attribute, value));
  return element;
}

function renderChart(card, metric, rows) {
  const chart = card.querySelector(".chart");
  const range = card.querySelectorAll(".chart-range span");
  const medianLabel = card.querySelector(".chart-median strong");
  const values = valuesFor(rows, metric);
  chart.replaceChildren();

  if (values.length < 2) {
    medianLabel.textContent = values.length ? formatTime(values[0], true) : "—";
    range[0].textContent = values.length ? formatTime(values[0], true) : "No data";
    range[1].textContent = values.length ? "1 result" : "";
    return;
  }

  const width = Math.max(chart.clientWidth, 280);
  const height = Math.max(chart.clientHeight, 160);
  const padding = { top: 18, right: 4, bottom: 2, left: 31 };
  const plotWidth = width - padding.left - padding.right;
  const { bins, minimum, maximum } = buildHistogram(values, plotWidth, metric);
  const maximumCount = Math.max(...bins.map((bin) => bin.count));
  const yMaximum = niceCountMaximum(maximumCount);
  const baseline = height - padding.bottom;
  const xScale = (value) =>
    padding.left + ((value - minimum) / (maximum - minimum)) * plotWidth;
  const yScale = (value) =>
    padding.top + (1 - value / yMaximum) * (baseline - padding.top);
  const median = quantile(values, 0.5);
  const svg = createSVGElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none",
    "aria-hidden": "true",
  });

  const grid = createSVGElement("g", { class: "count-grid" });
  const axisTitle = createSVGElement("text", {
    class: "count-axis-title",
    x: 0,
    y: 9,
  });
  axisTitle.textContent = "finishers";
  grid.append(axisTitle);

  [...new Set([0, Math.ceil(yMaximum / 2), yMaximum])].forEach((count) => {
    const y = yScale(count);
    const label = createSVGElement("text", {
      class: "count-axis-label",
      x: padding.left - 7,
      y: y + 3,
      "text-anchor": "end",
    });
    label.textContent = count;
    grid.append(
      createSVGElement("line", {
        class: "count-grid-line",
        x1: padding.left,
        x2: width - padding.right,
        y1: y,
        y2: y,
      }),
      label,
    );
  });
  svg.append(grid);

  const bars = createSVGElement("g", { class: "histogram-bars" });
  let placedFinishers = 0;
  bins.forEach((bin, binIndex) => {
    const x = xScale(bin.start);
    const nextX = xScale(bin.end);
    const barWidth = Math.max(nextX - x - 2, 1);
    const y = yScale(bin.count);
    const bar = createSVGElement("rect", {
      class: "histogram-bar",
      x: x + 1,
      y,
      width: barWidth,
      height: Math.max(baseline - y, 0),
      rx: Math.min(3, barWidth / 4),
      style: `fill: ${metrics[metric].color}`,
    });
    const hitArea = createSVGElement("rect", {
      class: "histogram-hit-area",
      x,
      y: padding.top,
      width: nextX - x,
      height: baseline - padding.top,
    });
    const performance = formatPerformance(metric, binIndex === 0 ? values[0] : bin.start);
    const firstPlace = placedFinishers + 1;
    placedFinishers += bin.count;
    const lastPlace = placedFinishers;

    function showTooltip() {
      const bounds = bar.getBoundingClientRect();
      const chartBounds = chart.getBoundingClientRect();
      activeTooltipBar?.classList.remove("is-active");
      tooltip.querySelector("strong").textContent =
        `${formatTime(bin.start, true)}–${formatTime(bin.end, true)}`;
      tooltip.querySelector(".tooltip-count").textContent = state.year !== "all"
        ? bin.count ? `Place ${firstPlace}–${lastPlace}` : "No finishers"
        : `${bin.count} ${bin.count === 1 ? "finisher" : "finishers"}`;
      const performanceLine = tooltip.querySelector(".tooltip-performance");
      performanceLine.textContent = performance ?? "";
      performanceLine.hidden = !performance;
      tooltip.hidden = false;
      const tooltipBounds = tooltip.getBoundingClientRect();
      const horizontalPadding = 8;
      const minimumLeft = tooltipBounds.width / 2 + horizontalPadding;
      const maximumLeft = window.innerWidth - tooltipBounds.width / 2 - horizontalPadding;
      const barCenter = bounds.left + bounds.width / 2;
      tooltip.style.left = `${Math.min(Math.max(barCenter, minimumLeft), maximumLeft)}px`;
      tooltip.style.top = `${Math.max(chartBounds.top + 8, 8)}px`;
      bar.classList.add("is-active");
      activeTooltipBar = bar;
    }

    function hideTooltip() {
      if (pinnedTooltip) {
        return;
      }
      bar.classList.remove("is-active");
      activeTooltipBar = null;
      tooltip.hidden = true;
    }

    function showHoverTooltip() {
      if (!pinnedTooltip) {
        showTooltip();
      }
    }

    function pinTooltip(event) {
      event.stopPropagation();
      if (pinnedTooltip?.bar === bar) {
        pinnedTooltip = null;
        return;
      }
      pinnedTooltip?.bar.classList.remove("is-active");
      pinnedTooltip = { bar };
      showTooltip();
    }

    hitArea.addEventListener("pointerenter", showHoverTooltip);
    hitArea.addEventListener("pointermove", showHoverTooltip);
    hitArea.addEventListener("pointerleave", hideTooltip);
    hitArea.addEventListener("click", pinTooltip);
    hitArea.addEventListener("focus", showHoverTooltip);
    hitArea.addEventListener("blur", hideTooltip);
    hitArea.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pinTooltip(event);
      }
    });
    hitArea.setAttribute("role", "button");
    hitArea.setAttribute("tabindex", "0");
    hitArea.setAttribute(
      "aria-label",
      `${formatTime(bin.start, true)} to ${formatTime(bin.end, true)}, ${bin.count} ${bin.count === 1 ? "finisher" : "finishers"}`,
    );
    bars.append(bar, hitArea);
  });

  svg.append(
    bars,
    createSVGElement("line", {
      class: "median-line",
      x1: xScale(median),
      x2: xScale(median),
      y1: padding.top,
      y2: baseline,
    }),
  );
  chart.append(svg);
  medianLabel.textContent = formatTime(median, true);
  range[0].textContent = formatTime(values[0], true);
  range[1].textContent = formatTime(values.at(-1), true);
  chart.setAttribute(
    "aria-label",
    `${metrics[metric].label} histogram for ${values.length} results. Median ${formatTime(median)}. Peak bin ${maximumCount} finishers.`,
  );
}

function render() {
  clearChartTooltip();
  const rows = filteredRows();
  const chartGrid = document.querySelector("#chart-grid");
  const emptyState = document.querySelector("#empty-state");
  const completedCount = valuesFor(rows, "total").length;

  document.querySelector("#result-count").textContent =
    `${completedCount.toLocaleString()} ${completedCount === 1 ? "finisher" : "finishers"}`;
  document.querySelector("#active-description").textContent = describeFilters();
  updateSummary(rows);

  chartGrid.hidden = rows.length === 0;
  emptyState.hidden = rows.length !== 0;

  document.querySelectorAll(".chart-card").forEach((card) => {
    renderChart(card, card.dataset.metric, rows);
  });
}

function filteredTableRows() {
  const direction = state.table.sortDirection === "asc" ? 1 : -1;
  return state.rows
    .filter(
      (row) =>
        (state.table.year === "all" || row.year === state.table.year)
        && (state.table.gender === "all" || row.gender === state.table.gender)
        && (state.table.age === "all" || row.age === state.table.age),
    )
    .sort((left, right) => {
      if (state.table.sortKey === "athlete") {
        return compareAthleteNames(left.name, right.name, direction)
          || compareRacePlaces(left.place, right.place);
      }

      if (state.table.sortKey === "place") {
        return compareRacePlaces(left.place, right.place, direction)
          || athleteNameCollator.compare(left.name, right.name);
      }

      const leftTime = left.times[state.table.sortKey];
      const rightTime = right.times[state.table.sortKey];
      if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) {
        return athleteNameCollator.compare(left.name, right.name);
      }
      if (!Number.isFinite(leftTime)) return 1;
      if (!Number.isFinite(rightTime)) return -1;
      return (leftTime - rightTime) * direction
        || athleteNameCollator.compare(left.name, right.name);
    });
}

function compareAthleteNames(leftName, rightName, direction) {
  const left = String(leftName).trim();
  const right = String(rightName).trim();
  const leftUnknown = !left || /^unknown(?: athlete)?$/i.test(left);
  const rightUnknown = !right || /^unknown(?: athlete)?$/i.test(right);

  if (leftUnknown && rightUnknown) {
    return 0;
  }
  if (leftUnknown) {
    return direction;
  }
  if (rightUnknown) {
    return -direction;
  }
  return athleteNameCollator.compare(left, right) * direction;
}

function compareRacePlaces(leftPlace, rightPlace, direction = 1) {
  const left = String(leftPlace).trim().toUpperCase();
  const right = String(rightPlace).trim().toUpperCase();
  const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
  const rightNumber = /^\d+$/.test(right) ? Number(right) : null;

  if (leftNumber !== null && rightNumber !== null) {
    return (leftNumber - rightNumber) * direction;
  }
  if (leftNumber !== null) {
    return -direction;
  }
  if (rightNumber !== null) {
    return direction;
  }

  const leftStatusIndex = raceStatusOrder.indexOf(left);
  const rightStatusIndex = raceStatusOrder.indexOf(right);
  const leftStatusRank = leftStatusIndex === -1 ? raceStatusOrder.length : leftStatusIndex;
  const rightStatusRank = rightStatusIndex === -1 ? raceStatusOrder.length : rightStatusIndex;
  return leftStatusRank - rightStatusRank || left.localeCompare(right);
}

function appendTableCell(tableRow, value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = value || "—";
  if (className) {
    cell.className = className;
  }
  tableRow.append(cell);
  return cell;
}

function tableRowKey(row) {
  return JSON.stringify([row.year, row.place, row.bib, row.name]);
}

function updateTableRowSelection(fallbackRow = null) {
  const tableRows = [...document.querySelectorAll("#results-table-body tr[data-row-key]")];
  const selectedRow = tableRows.find(
    (tableRow) => tableRow.dataset.rowKey === state.table.selectedKey,
  );
  const keyboardRow = selectedRow ?? fallbackRow ?? tableRows[0];

  tableRows.forEach((tableRow) => {
    const selected = tableRow === selectedRow;
    tableRow.classList.toggle("is-selected", selected);
    tableRow.setAttribute("aria-selected", String(selected));
    tableRow.tabIndex = tableRow === keyboardRow ? 0 : -1;
  });
}

function toggleTableRowSelection(tableRow, blurWhenCleared = false) {
  const clearingSelection = state.table.selectedKey === tableRow.dataset.rowKey;
  state.table.selectedKey = clearingSelection ? null : tableRow.dataset.rowKey;
  updateTableRowSelection(tableRow);
  if (clearingSelection && blurWhenCleared) {
    tableRow.blur();
  } else {
    tableRow.focus({ preventScroll: true });
  }
}

function handleTableRowSelection(event) {
  const tableRow = event.target.closest("tr[data-row-key]");
  if (tableRow) {
    toggleTableRowSelection(tableRow, true);
  }
}

function handleTableRowSelectionKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const tableRow = event.target.closest("tr[data-row-key]");
  if (tableRow) {
    event.preventDefault();
    toggleTableRowSelection(tableRow);
  }
}

function renderTable() {
  const rows = filteredTableRows();
  const body = document.querySelector("#results-table-body");
  const fragment = document.createDocumentFragment();
  body.replaceChildren();
  document.querySelector("#table-result-count").textContent =
    `${rows.length.toLocaleString()} ${rows.length === 1 ? "result" : "results"}`;

  if (!rows.length) {
    const tableRow = document.createElement("tr");
    const cell = appendTableCell(tableRow, "No matching results", "table-empty-cell");
    cell.colSpan = 9;
    fragment.append(tableRow);
  } else {
    rows.forEach((row) => {
      const tableRow = document.createElement("tr");
      tableRow.dataset.rowKey = tableRowKey(row);
      appendTableCell(tableRow, row.place, "place-cell");

      const athleteCell = document.createElement("td");
      athleteCell.className = "athlete-cell";
      const athleteName = document.createElement("strong");
      athleteName.textContent = row.name || "Unknown athlete";
      const athleteDetail = document.createElement("small");
      athleteDetail.textContent = row.club || (row.bib ? `Bib ${row.bib}` : "Independent");
      if (row.club) {
        athleteDetail.title = row.club;
      }
      athleteCell.append(athleteName, athleteDetail);
      tableRow.append(athleteCell);

      appendTableCell(tableRow, formatRaceGroup(row), "group-cell");
      appendTableCell(tableRow, formatTableTime(row.timeLabels.total), "time-cell total-cell");
      appendTableCell(tableRow, formatTableTime(row.timeLabels.swim), "time-cell");
      appendTableCell(
        tableRow,
        formatTableTime(row.timeLabels.t1),
        "time-cell transition-cell",
      );
      appendTableCell(tableRow, formatTableTime(row.timeLabels.bike), "time-cell");
      appendTableCell(
        tableRow,
        formatTableTime(row.timeLabels.t2),
        "time-cell transition-cell",
      );
      appendTableCell(tableRow, formatTableTime(row.timeLabels.run), "time-cell");
      fragment.append(tableRow);
    });
  }

  body.append(fragment);
  updateTableRowSelection();
  updateTableSortControls();
  syncResultsHeader();
}

function setToggleValue(container, value) {
  container.querySelectorAll("button").forEach((button) => {
    const selected = button.dataset.value === value;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function controlsForView(view) {
  return view === "results"
    ? { year: controls.tableYear, gender: controls.tableGender, age: controls.tableAge }
    : { year: controls.year, gender: controls.gender, age: controls.age };
}

function filterStateForView(view) {
  return view === "results" ? state.table : state;
}

function ageUrlValue(value) {
  return value.replaceAll("–", "-");
}

function availableFilterValue(view, filter, requestedValue) {
  if (!requestedValue) {
    return null;
  }

  const control = controlsForView(view)[filter];
  if (filter === "age") {
    return [...control.options]
      .map((option) => option.value)
      .find((value) => ageUrlValue(value) === ageUrlValue(requestedValue)) ?? null;
  }

  return [...control.querySelectorAll("button[data-value]")]
    .map((button) => button.dataset.value)
    .find((value) => value === requestedValue) ?? null;
}

function syncFilterControls(view) {
  const filterState = filterStateForView(view);
  const viewControls = controlsForView(view);
  setToggleValue(viewControls.year, filterState.year);
  setToggleValue(viewControls.gender, filterState.gender);
  viewControls.age.value = filterState.age;
}

function applyUrlState() {
  const parameters = new URL(window.location.href).searchParams;
  const requestedView = parameters.get("tab") ?? "charts";
  state.view = ["charts", "results", "links"].includes(requestedView)
    ? requestedView
    : "charts";

  if (state.view === "links") {
    return;
  }

  const filterState = filterStateForView(state.view);
  const defaults = filterDefaults[state.view];
  ["year", "gender", "age"].forEach((filter) => {
    filterState[filter] =
      availableFilterValue(state.view, filter, parameters.get(filter))
      ?? defaults[filter];
  });
  syncFilterControls(state.view);
}

function updateUrl(push = false) {
  const url = new URL(window.location.href);
  urlStateKeys.forEach((key) => url.searchParams.delete(key));

  if (state.view !== "charts") {
    url.searchParams.set("tab", state.view);
  }

  if (state.view !== "links") {
    const filterState = filterStateForView(state.view);
    const defaults = filterDefaults[state.view];
    ["year", "gender", "age"].forEach((filter) => {
      if (filterState[filter] !== defaults[filter]) {
        const value = filter === "age"
          ? ageUrlValue(filterState[filter])
          : filterState[filter];
        url.searchParams.set(filter, value);
      }
    });
  }

  const method = push ? "pushState" : "replaceState";
  window.history[method]({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function handleTableToggle(event) {
  const button = event.target.closest("button[data-value]");
  if (!button) {
    return;
  }
  const container = event.currentTarget;
  const filter = container.dataset.tableFilter;
  state.table[filter] = button.dataset.value;
  setToggleValue(container, button.dataset.value);
  renderTable();
  updateUrl();
}

function updateTableSortControls() {
  const labels = {
    place: "place",
    athlete: "athlete",
    total: "total time",
    swim: "swim",
    t1: "T1",
    bike: "bike",
    t2: "T2",
    run: "run",
  };
  const directionLabel = state.table.sortDirection === "asc" ? "ascending" : "descending";
  document.querySelector("#table-sort-description").textContent =
    `Sorted by ${labels[state.table.sortKey]} · ${directionLabel}`;

  document.querySelectorAll(".sort-button").forEach((button) => {
    const selected = button.dataset.sort === state.table.sortKey;
    const header = button.closest("th");
    button.classList.toggle("is-active", selected);
    button.querySelector(".sort-indicator").textContent = selected
      ? state.table.sortDirection === "asc" ? "↑" : "↓"
      : "";
    if (selected) {
      header.setAttribute("aria-sort", directionLabel);
    } else {
      header.removeAttribute("aria-sort");
    }
  });
}

function handleTableSort(event) {
  const button = event.target.closest(".sort-button");
  if (!button) {
    return;
  }
  const sortKey = button.dataset.sort;
  if (state.table.sortKey === sortKey) {
    state.table.sortDirection = state.table.sortDirection === "asc" ? "desc" : "asc";
  } else {
    state.table.sortKey = sortKey;
    state.table.sortDirection = "asc";
  }
  renderTable();
}

function setupResultsHeader() {
  const wrapper = document.querySelector(".results-table-wrap");
  const sourceTable = document.querySelector(".results-table");
  const floatingHeader = document.createElement("div");
  const floatingTable = document.createElement("table");
  let animationFrame = null;

  floatingHeader.className = "floating-results-header";
  floatingHeader.hidden = true;
  floatingHeader.setAttribute("aria-label", "Sticky race result sorting");
  floatingTable.className = "results-table";
  floatingTable.append(sourceTable.tHead.cloneNode(true));
  floatingHeader.append(floatingTable);
  document.body.append(floatingHeader);

  function updateHeader() {
    animationFrame = null;
    const resultsView = document.querySelector("#results-view");
    if (resultsView.hidden) {
      floatingHeader.hidden = true;
      return;
    }

    const wrapperBounds = wrapper.getBoundingClientRect();
    const headerHeight = sourceTable.tHead.getBoundingClientRect().height;
    const shouldFloat = wrapperBounds.top < 0 && wrapperBounds.bottom > headerHeight;
    floatingHeader.hidden = !shouldFloat;
    if (!shouldFloat) {
      return;
    }

    const sourceHeaders = sourceTable.tHead.querySelectorAll("th");
    const floatingHeaders = floatingTable.tHead.querySelectorAll("th");
    sourceHeaders.forEach((header, index) => {
      const width = header.getBoundingClientRect().width;
      floatingHeaders[index].style.width = `${width}px`;
      floatingHeaders[index].style.minWidth = `${width}px`;
      floatingHeaders[index].style.maxWidth = `${width}px`;
    });

    floatingHeader.style.left = `${wrapperBounds.left}px`;
    floatingHeader.style.width = `${wrapperBounds.width}px`;
    floatingHeader.style.height = `${headerHeight}px`;
    floatingTable.style.width = `${sourceTable.getBoundingClientRect().width}px`;
    floatingTable.style.transform = `translateX(${-wrapper.scrollLeft}px)`;
  }

  syncResultsHeader = () => {
    if (animationFrame === null) {
      animationFrame = window.requestAnimationFrame(updateHeader);
    }
  };

  window.addEventListener("scroll", syncResultsHeader, { passive: true });
  window.addEventListener("resize", syncResultsHeader);
  wrapper.addEventListener("scroll", syncResultsHeader, { passive: true });
}

function switchDashboardView(view, { syncUrl = true, pushUrl = false } = {}) {
  state.view = view;
  document.querySelectorAll(".view-tab").forEach((tab) => {
    const selected = tab.dataset.viewTarget === view;
    tab.classList.toggle("is-active", selected);
    tab.setAttribute("aria-pressed", String(selected));
  });
  document.querySelectorAll("[data-dashboard-view]").forEach((section) => {
    section.hidden = section.dataset.dashboardView !== view;
  });
  if (view === "charts") {
    render();
  } else if (view === "results") {
    renderTable();
  }
  syncResultsHeader();
  if (syncUrl) {
    updateUrl(pushUrl);
  }
}

function handleChartToggle(event) {
  const button = event.target.closest("button[data-value]");
  if (!button) {
    return;
  }
  const container = event.currentTarget;
  state[container.dataset.chartFilter] = button.dataset.value;
  setToggleValue(container, button.dataset.value);
  render();
  updateUrl();
}

function bindEvents() {
  const resultsTableBody = document.querySelector("#results-table-body");

  [controls.year, controls.gender].forEach((control) => {
    control.addEventListener("click", handleChartToggle);
  });
  controls.age.addEventListener("change", () => {
    state.age = controls.age.value;
    render();
    updateUrl();
  });

  document.querySelectorAll(".view-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const view = tab.dataset.viewTarget;
      switchDashboardView(view, { pushUrl: view !== state.view });
    });
  });
  document.addEventListener("click", clearChartTooltip);
  document.addEventListener("click", handleTableSort);
  resultsTableBody.addEventListener("click", handleTableRowSelection);
  resultsTableBody.addEventListener("keydown", handleTableRowSelectionKeydown);
  controls.tableYear.addEventListener("click", handleTableToggle);
  controls.tableGender.addEventListener("click", handleTableToggle);
  controls.tableAge.addEventListener("change", () => {
    state.table.age = controls.tableAge.value;
    renderTable();
    updateUrl();
  });
  controls.tableReset.addEventListener("click", () => {
    state.table.year = controls.tableYear.querySelector("button:last-child").dataset.value;
    state.table.gender = "all";
    state.table.age = "all";
    state.table.sortKey = "place";
    state.table.sortDirection = "asc";
    setToggleValue(controls.tableYear, state.table.year);
    setToggleValue(controls.tableGender, "all");
    controls.tableAge.value = "all";
    renderTable();
    updateUrl();
  });

  controls.reset.addEventListener("click", () => {
    state.year = "all";
    state.gender = "all";
    state.age = "all";
    setToggleValue(controls.year, "all");
    setToggleValue(controls.gender, "all");
    controls.age.value = "all";
    render();
    updateUrl();
  });

  window.addEventListener("popstate", () => {
    applyUrlState();
    switchDashboardView(state.view, { syncUrl: false });
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (document.querySelector(".view-tab.is-active").dataset.viewTarget === "charts") {
        render();
      }
    }, 120);
  });
}

async function init() {
  try {
    const response = await fetch(DATA_URL);
    if (!response.ok) {
      throw new Error(`Could not load results (${response.status})`);
    }
    state.rows = prepareRows(parseCSV(await response.text()));
    populateFilters();
    applyUrlState();
    bindEvents();
    setupResultsHeader();
    switchDashboardView(state.view, { syncUrl: false });
    updateUrl();
  } catch (error) {
    document.querySelector("#result-count").textContent = "Results unavailable";
    document.querySelector("#active-description").textContent = error.message;
    document.querySelector("#chart-grid").hidden = true;
    document.querySelector("#summary-grid").hidden = true;
    const emptyState = document.querySelector("#empty-state");
    emptyState.hidden = false;
    emptyState.querySelector("h3").textContent = "Could not load the CSV";
    emptyState.querySelector("p").textContent = "Serve this folder over HTTP or open the published GitHub Pages site.";
  }
}

init();
