const DATA_URL = "trialogevent_results_2023_2025.csv";

const metrics = {
  total: { column: "Totalzeit", label: "Total time", color: "#d8ff55" },
  swim: { column: "Schwimmen", label: "Swim", color: "#9edbf4" },
  t1: { column: "Wechsel_1", label: "Transition 1", color: "#ffd266" },
  bike: { column: "Rad", label: "Bike", color: "#d8ff55" },
  t2: { column: "Wechsel_2", label: "Transition 2", color: "#ffb5a8" },
  run: { column: "Lauf", label: "Run", color: "#a7baff" },
};

const state = {
  rows: [],
  year: "all",
  gender: "all",
  age: "all",
};

const controls = {
  year: document.querySelector("#year-filter"),
  gender: document.querySelector("#gender-filter"),
  age: document.querySelector("#age-filter"),
  reset: document.querySelector("#reset-filters"),
};

const tooltip = document.querySelector("#chart-tooltip");
let resizeTimer;

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
    gender: row.Gender.toLowerCase(),
    age: normalizeAgeGroup(row.Altersklasse),
    times: Object.fromEntries(
      Object.entries(metrics).map(([key, metric]) => [key, parseTime(row[metric.column])]),
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

function populateFilters() {
  const years = [...new Set(state.rows.map((row) => row.year))].sort();
  const genders = [...new Set(state.rows.map((row) => row.gender))].sort();
  const ageGroups = [...new Set(state.rows.map((row) => row.age))].sort(numericSort);

  addOptions(controls.year, years);
  addOptions(controls.gender, genders, (gender) => {
    const labels = { female: "Women", male: "Men", mixed: "Mixed", nonbinary: "Non-binary" };
    return labels[gender] ?? gender;
  });
  addOptions(controls.age, ageGroups);
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
    labels.push(controls.gender.selectedOptions[0].textContent);
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

    function showTooltip(event) {
      const bounds = bar.getBoundingClientRect();
      tooltip.querySelector("strong").textContent =
        `${formatTime(bin.start, true)}–${formatTime(bin.end, true)}`;
      tooltip.querySelector(".tooltip-count").textContent =
        `${bin.count} ${bin.count === 1 ? "finisher" : "finishers"}`;
      const performanceLine = tooltip.querySelector(".tooltip-performance");
      performanceLine.textContent = performance ?? "";
      performanceLine.hidden = !performance;
      tooltip.style.left = `${event.clientX ?? bounds.left + bounds.width / 2}px`;
      tooltip.style.top = `${event.clientY ?? bounds.top}px`;
      tooltip.hidden = false;
      bar.classList.add("is-active");
    }

    function hideTooltip() {
      tooltip.hidden = true;
      bar.classList.remove("is-active");
    }

    hitArea.addEventListener("pointerenter", showTooltip);
    hitArea.addEventListener("pointermove", showTooltip);
    hitArea.addEventListener("pointerleave", hideTooltip);
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

function handleFilterChange(event) {
  state[event.target.id.replace("-filter", "")] = event.target.value;
  render();
}

function bindEvents() {
  [controls.year, controls.gender, controls.age].forEach((control) => {
    control.addEventListener("change", handleFilterChange);
  });

  controls.reset.addEventListener("click", () => {
    state.year = "all";
    state.gender = "all";
    state.age = "all";
    controls.year.value = "all";
    controls.gender.value = "all";
    controls.age.value = "all";
    render();
  });

  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(render, 120);
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
    bindEvents();
    render();
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
