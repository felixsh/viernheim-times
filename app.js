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
    document.querySelector(`#stat-${metric}`).textContent = formatTime(quantile(values, 0.5));
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

function kernelDensity(values, minimum, maximum, points = 90) {
  const count = values.length;
  const mean = values.reduce((sum, value) => sum + value, 0) / count;
  const standardDeviation = Math.sqrt(
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0)
      / Math.max(count - 1, 1),
  );
  const spread = Math.max(maximum - minimum, 1);
  const bandwidth = Math.max(1.06 * standardDeviation * count ** -0.2, spread / 45);
  const density = [];

  for (let index = 0; index < points; index += 1) {
    const x = minimum + (index / (points - 1)) * (maximum - minimum);
    const y =
      values.reduce((sum, value) => {
        const distance = (x - value) / bandwidth;
        return sum + Math.exp(-0.5 * distance * distance);
      }, 0)
      / (count * bandwidth * Math.sqrt(2 * Math.PI));
    density.push({ x, y });
  }
  return density;
}

function createSVGElement(name, attributes = {}) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attributes).forEach(([attribute, value]) => element.setAttribute(attribute, value));
  return element;
}

function linePath(points, xScale, yScale) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"}${xScale(point.x).toFixed(2)},${yScale(point.y).toFixed(2)}`)
    .join(" ");
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
  const padding = { top: 12, right: 4, bottom: 2, left: 4 };
  const firstPercentile = quantile(values, 0.01);
  const lastPercentile = quantile(values, 0.99);
  const spread = Math.max(lastPercentile - firstPercentile, 1);
  const minimum = Math.max(0, firstPercentile - spread * 0.06);
  const maximum = lastPercentile + spread * 0.06;
  const density = kernelDensity(values, minimum, maximum);
  const maxDensity = Math.max(...density.map((point) => point.y));
  const baseline = height - padding.bottom;
  const xScale = (value) =>
    padding.left + ((value - minimum) / (maximum - minimum)) * (width - padding.left - padding.right);
  const yScale = (value) =>
    padding.top + (1 - value / maxDensity) * (baseline - padding.top);
  const path = linePath(density, xScale, yScale);
  const areaPath = `${path} L${xScale(maximum)},${baseline} L${xScale(minimum)},${baseline} Z`;
  const median = quantile(values, 0.5);
  const lowerQuartile = quantile(values, 0.25);
  const upperQuartile = quantile(values, 0.75);
  const svg = createSVGElement("svg", {
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none",
    "aria-hidden": "true",
  });

  svg.append(
    createSVGElement("line", {
      class: "baseline",
      x1: padding.left,
      x2: width - padding.right,
      y1: baseline,
      y2: baseline,
    }),
    createSVGElement("line", {
      class: "quartile-line",
      x1: xScale(lowerQuartile),
      x2: xScale(upperQuartile),
      y1: baseline - 5,
      y2: baseline - 5,
    }),
    createSVGElement("path", {
      class: "density-area",
      d: areaPath,
      style: `fill: ${metrics[metric].color}`,
    }),
    createSVGElement("path", { class: "density-line", d: path }),
    createSVGElement("line", {
      class: "median-line",
      x1: xScale(median),
      x2: xScale(median),
      y1: padding.top,
      y2: baseline,
    }),
  );

  const hoverLine = createSVGElement("line", {
    class: "hover-line",
    x1: 0,
    x2: 0,
    y1: padding.top,
    y2: baseline,
    visibility: "hidden",
  });
  const hitArea = createSVGElement("rect", {
    class: "chart-hit-area",
    x: padding.left,
    y: 0,
    width: width - padding.left - padding.right,
    height,
  });

  function showTooltip(event) {
    const bounds = svg.getBoundingClientRect();
    const relativeX = Math.min(Math.max(event.clientX - bounds.left, 0), bounds.width);
    const value = minimum + (relativeX / bounds.width) * (maximum - minimum);
    const nearbyCount = values.filter(
      (time) => Math.abs(time - value) <= (maximum - minimum) * 0.025,
    ).length;
    const svgX = (relativeX / bounds.width) * width;

    hoverLine.setAttribute("x1", svgX);
    hoverLine.setAttribute("x2", svgX);
    hoverLine.setAttribute("visibility", "visible");
    tooltip.querySelector("strong").textContent = formatTime(value, true);
    tooltip.querySelector("span").textContent = `${nearbyCount} nearby ${nearbyCount === 1 ? "result" : "results"}`;
    tooltip.style.left = `${event.clientX}px`;
    tooltip.style.top = `${event.clientY}px`;
    tooltip.hidden = false;
  }

  hitArea.addEventListener("pointermove", showTooltip);
  hitArea.addEventListener("pointerleave", () => {
    hoverLine.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  });

  svg.append(hoverLine, hitArea);
  chart.append(svg);
  medianLabel.textContent = formatTime(median, true);
  range[0].textContent = `${formatTime(minimum, true)} faster`;
  range[1].textContent = `${formatTime(maximum, true)} slower`;
  chart.setAttribute(
    "aria-label",
    `${metrics[metric].label} density plot for ${values.length} results. Median ${formatTime(median)}.`,
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
