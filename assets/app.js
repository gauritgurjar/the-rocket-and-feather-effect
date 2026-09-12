(() => {
  const COLORS = {
    navy: "#1b3a4b",
    gold: "#c4a35a",
    up: "#725d5d",
    down: "#4a6274",
    muted: "#5a666a",
    cream: "#eaf0ec",
  };

  const ALL = "all";
  let data = null;
  let seriesChart = null;
  let barsChart = null;

  const $ = (id) => document.getElementById(id);

  function fmtPct(value, digits = 1) {
    if (value == null || Number.isNaN(value)) return "n/a";
    const n = Number(value);
    const sign = n > 0 ? "+" : "";
    return `${sign}${n.toFixed(digits)}%`;
  }

  function mean(values) {
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function countryByCode(code) {
    return data.countries.find((c) => c.code === code);
  }

  function seriesKeys(code, food) {
    if (food !== ALL) {
      const key = `${code}|${food}`;
      return data.series[key] ? [key] : [];
    }
    return Object.keys(data.series).filter((k) => k.startsWith(`${code}|`));
  }

  function filterPoints(points, fromYear, toYear) {
    return points.filter((p) => p.y >= fromYear && p.y <= toYear && p.cpi100 != null && p.ppi100 != null);
  }

  function pooledStats(code, food, fromYear, toYear) {
    const rawUp = [];
    const rawDown = [];
    const rawPpiUp = [];
    const rawPpiDown = [];
    seriesKeys(code, food).forEach((key) => {
      const points = filterPoints(data.series[key].points, fromYear, toYear);
      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1];
        const cur = points[i];
        if (cur.y * 4 + cur.q !== prev.y * 4 + prev.q + 1) continue;
        if (!prev.cpi || !cur.cpi || !prev.ppi || !cur.ppi) continue;
        const dcpi = (cur.cpi / prev.cpi - 1) * 100;
        const dppi = (cur.ppi / prev.ppi - 1) * 100;
        if (dppi > 0) {
          rawUp.push(dcpi);
          rawPpiUp.push(dppi);
        } else if (dppi < 0) {
          rawDown.push(dcpi);
          rawPpiDown.push(dppi);
        }
      }
    });
    return {
      nUp: rawUp.length,
      nDown: rawDown.length,
      cpiUp: mean(rawUp),
      cpiDown: mean(rawDown),
      ppiUp: mean(rawPpiUp),
      ppiDown: mean(rawPpiDown),
    };
  }

  function averageSeries(code, food, fromYear, toYear) {
    const keys = seriesKeys(code, food);
    const byDate = new Map();
    keys.forEach((key) => {
      filterPoints(data.series[key].points, fromYear, toYear).forEach((p) => {
        const rec = byDate.get(p.d) || { d: p.d, y: p.y, q: p.q, cpi: [], ppi: [] };
        rec.cpi.push(p.cpi100);
        rec.ppi.push(p.ppi100);
        byDate.set(p.d, rec);
      });
    });
    return [...byDate.values()]
      .sort((a, b) => a.d.localeCompare(b.d))
      .map((rec) => ({
        label: `${rec.y} Q${rec.q}`,
        cpi: mean(rec.cpi),
        ppi: mean(rec.ppi),
      }));
  }

  function verdictCopy(country, food, stats) {
    const foodLabel = food === ALL ? "paired foods" : food.toLowerCase();
    if (!stats.nUp && !stats.nDown) {
      return {
        title: `${country.name} has no paired quarters in this window.`,
        body: country.coverage || "Try a wider year range or another food.",
      };
    }
    const down = stats.cpiDown;
    let title;
    if (down == null) {
      title = `${country.name} ${foodLabel}: not enough down-quarters to judge the feather.`;
    } else if (down >= 0.25) {
      title = `${country.name} ${foodLabel} stayed sticky. Groceries still rose when the farm eased.`;
    } else if (down > -0.15) {
      title = `${country.name} ${foodLabel} went almost flat when farm prices fell.`;
    } else {
      title = `${country.name} ${foodLabel} did fall with the farm — not one-for-one.`;
    }
    const body = [
      stats.cpiUp != null ? `When producer prices rose (n=${stats.nUp}), groceries moved ${fmtPct(stats.cpiUp)}.` : null,
      stats.cpiDown != null ? `When they fell (n=${stats.nDown}), groceries moved ${fmtPct(stats.cpiDown)}.` : null,
      country.blurb,
    ]
      .filter(Boolean)
      .join(" ");
    return { title, body };
  }

  function syncUrl(state) {
    const url = new URL(window.location.href);
    url.searchParams.set("c", state.country);
    url.searchParams.set("f", state.food);
    url.searchParams.set("from", String(state.from));
    url.searchParams.set("to", String(state.to));
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function fillSelects(state) {
    const country = $("country");
    country.innerHTML = data.countries
      .map((c) => `<option value="${c.code}">${c.rank}. ${c.name}</option>`)
      .join("");
    country.value = data.countries.some((c) => c.code === state.country) ? state.country : "USA";

    const selected = countryByCode(country.value);
    const foods = selected.categories;
    $("food").innerHTML = [
      `<option value="${ALL}">All paired foods</option>`,
      ...data.categories
        .filter((name) => foods.includes(name))
        .map((name) => `<option value="${name}">${name}</option>`),
    ].join("");
    $("food").value = foods.includes(state.food) || state.food === ALL ? state.food : ALL;

    const years = [];
    for (let y = data.meta.window.minYear; y <= data.meta.window.maxYear; y += 1) years.push(y);
    const yearOpts = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    $("year-from").innerHTML = yearOpts;
    $("year-to").innerHTML = yearOpts;
    $("year-from").value = state.from;
    $("year-to").value = state.to;
  }

  function chartDefaults() {
    Chart.defaults.font.family = "'Source Sans 3', sans-serif";
    Chart.defaults.color = COLORS.muted;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
  }

  function renderSeries(rows) {
    const cfg = {
      type: "line",
      data: {
        labels: rows.map((r) => r.label),
        datasets: [
          {
            label: "Grocery shelf (CPI)",
            data: rows.map((r) => r.cpi),
            borderColor: COLORS.navy,
            backgroundColor: COLORS.navy,
            borderWidth: 2.2,
            pointRadius: 0,
            tension: 0.15,
          },
          {
            label: "Farm / factory (PPI)",
            data: rows.map((r) => r.ppi),
            borderColor: COLORS.gold,
            backgroundColor: COLORS.gold,
            borderWidth: 2.2,
            pointRadius: 0,
            tension: 0.15,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { position: "bottom" },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(1)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: {
            title: { display: true, text: "Index (2021 Q1 = 100)" },
            grid: { color: COLORS.cream },
          },
        },
      },
    };
    if (seriesChart) {
      seriesChart.data = cfg.data;
      seriesChart.update();
    } else {
      seriesChart = new Chart($("series-chart"), cfg);
    }
  }

  function renderBars(stats) {
    const cfg = {
      type: "bar",
      data: {
        labels: ["Farm / factory rose", "Farm / factory fell"],
        datasets: [
          {
            label: "Grocery price change",
            data: [stats.cpiUp, stats.cpiDown],
            backgroundColor: [COLORS.up, COLORS.down],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: (ctx) => fmtPct(ctx.parsed.y) },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            title: { display: true, text: "Average grocery change (%)" },
            grid: { color: COLORS.cream },
          },
        },
      },
    };
    if (barsChart) {
      barsChart.data = cfg.data;
      barsChart.update();
    } else {
      barsChart = new Chart($("bars-chart"), cfg);
    }
  }

  function renderRank(active) {
    $("rank-body").innerHTML = data.countries
      .map((c) => {
        const downClass = c.cpiDown >= 0 ? "pos" : "neg";
        return `<tr class="${c.code === active ? "active" : ""}">
          <td class="num">${c.rank}</td>
          <td><button type="button" data-country="${c.code}">${c.name}</button></td>
          <td class="num">${fmtPct(c.cpiUp)}</td>
          <td class="num ${downClass}">${fmtPct(c.cpiDown)}</td>
          <td>${c.label}</td>
        </tr>`;
      })
      .join("");
    $("rank-body").querySelectorAll("button").forEach((btn) => {
      btn.style.cssText = "background:none;border:0;padding:0;color:inherit;font:inherit;font-weight:700;cursor:pointer;text-decoration:underline;";
      btn.addEventListener("click", () => {
        $("country").value = btn.dataset.country;
        update();
        $("explore").scrollIntoView({ behavior: "smooth" });
      });
    });
  }

  function sourceLine(state) {
    const keys = seriesKeys(state.country, state.food);
    if (!keys.length) return "No paired series for this filter.";
    if (state.food === ALL) {
      const country = countryByCode(state.country);
      return `Paired official series for ${country.name}: ${country.categories.join(", ")}. Quarterly values; monthly sources averaged over complete months.`;
    }
    const rec = data.series[keys[0]];
    return `${rec.cpiSource || "CPI"} · ${rec.cpiName}. ${rec.ppiSource || "PPI"} · ${rec.ppiName}.`;
  }

  function updateHero() {
    $("hero-up").textContent = fmtPct(data.meta.overall.cpiUp);
    $("hero-down").textContent = fmtPct(data.meta.overall.cpiDown);
  }

  function update() {
    let from = Number($("year-from").value);
    let to = Number($("year-to").value);
    if (from > to) {
      if (document.activeElement === $("year-from")) $("year-to").value = from;
      else $("year-from").value = to;
      from = Number($("year-from").value);
      to = Number($("year-to").value);
    }
    const state = {
      country: $("country").value,
      food: $("food").value,
      from,
      to,
    };
    const country = countryByCode(state.country);
    const foods = country.categories;
    const foodOptions = [
      `<option value="${ALL}">All paired foods</option>`,
      ...data.categories.filter((name) => foods.includes(name)).map((name) => `<option value="${name}">${name}</option>`),
    ].join("");
    if ($("food").innerHTML !== foodOptions) {
      const keep = foods.includes(state.food) || state.food === ALL ? state.food : ALL;
      $("food").innerHTML = foodOptions;
      $("food").value = keep;
      state.food = keep;
    }
    const stats = pooledStats(state.country, state.food, state.from, state.to);
    const copy = verdictCopy(country, state.food, stats);
    $("verdict").innerHTML = `<h3>${copy.title}</h3><p>${copy.body}</p>`;
    const rows = averageSeries(state.country, state.food, state.from, state.to);
    renderSeries(rows);
    renderBars(stats);
    renderRank(state.country);
    $("source-line").textContent = sourceLine(state);
    $("series-caption").textContent =
      state.food === ALL
        ? `Average of available paired foods in ${country.name}, 2021 Q1 = 100`
        : `${state.food} in ${country.name}, 2021 Q1 = 100`;
    syncUrl(state);
  }

  function bind() {
    ["country", "food", "year-from", "year-to"].forEach((id) => {
      $(id).addEventListener("input", update);
      $(id).addEventListener("change", update);
    });
    document.querySelectorAll(".year-presets button").forEach((btn) => {
      btn.addEventListener("click", () => {
        $("year-from").value = btn.dataset.from;
        $("year-to").value = btn.dataset.to;
        update();
      });
    });
  }

  fetch("data/site.json")
    .then((res) => {
      if (!res.ok) throw new Error("Could not load site data");
      return res.json();
    })
    .then((payload) => {
      data = payload;
      chartDefaults();
      updateHero();
      const state = {
        country: new URLSearchParams(window.location.search).get("c") || "USA",
        food: new URLSearchParams(window.location.search).get("f") || ALL,
        from: Number(new URLSearchParams(window.location.search).get("from") || data.meta.window.minYear),
        to: Number(new URLSearchParams(window.location.search).get("to") || data.meta.window.maxYear),
      };
      fillSelects(state);
      bind();
      update();
    })
    .catch((err) => {
      $("verdict").innerHTML = `<h3>Could not load the dataset.</h3><p>${err.message}. Open this folder through a local server so <code>data/site.json</code> can load.</p>`;
    });
})();
