/**
 * 在页面 MAIN world 执行：可访问页面的 echarts 全局对象。
 * 禁止 getOption() 读 series.data；数值只来自 tooltip DOM。
 */
async function scrapeEchartsViaTooltip() {
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function findChartDom() {
    const marked = document.querySelector('[_echarts_instance_]');
    if (marked) return marked;
    const canvas = document.querySelector('canvas');
    return canvas?.parentElement?.parentElement || canvas?.parentElement || null;
  }

  function findTooltipRoot() {
    const nodes = [...document.querySelectorAll('div')].filter((n) => {
      if (n.id === 'chart') return false;
      const s = getComputedStyle(n);
      if (s.position !== 'absolute') return false;
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const t = (n.innerText || n.textContent || '').trim();
      if (!t || t.length > 180) return false;
      if (!/销量|：|:/.test(t)) return false;
      if (!/类目[A-Z]/.test(t)) return false;
      return Number(s.zIndex) >= 100 || s.zIndex === 'auto';
    });
    if (!nodes.length) return null;
    return nodes.sort(
      (a, b) =>
        (a.innerText || '').trim().length - (b.innerText || '').trim().length,
    )[0];
  }

  function parseTooltipText(text) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const m =
      normalized.match(/(类目[A-Z]).*?销量[:：]\s*(\d+)/i) ||
      normalized.match(/(类目[A-Z]).*?(\d+)/i);
    if (!m) return null;
    return { category: m[1], value: Number(m[2]), raw: normalized };
  }

  function readTipOnce() {
    const tip = findTooltipRoot();
    if (!tip) return null;
    return parseTooltipText(tip.innerText || tip.textContent || '');
  }

  if (typeof echarts === 'undefined' || !echarts.getInstanceByDom) {
    return {
      ok: false,
      error: '页面没有全局 echarts（无法 getInstanceByDom / showTip）',
    };
  }

  const chartRoot = findChartDom();
  if (!chartRoot) {
    return { ok: false, error: '未找到带 _echarts_instance_ 的图表容器' };
  }

  const chart = echarts.getInstanceByDom(chartRoot);
  if (!chart) {
    return { ok: false, error: 'getInstanceByDom 失败' };
  }

  const seen = new Map();
  let emptyStreak = 0;
  let lastCategory = null;
  let sameCategoryStreak = 0;
  const maxProbe = 24;

  for (let dataIndex = 0; dataIndex < maxProbe; dataIndex++) {
    chart.dispatchAction({
      type: 'showTip',
      seriesIndex: 0,
      dataIndex,
    });
    await sleep(40);

    const parsed = readTipOnce();
    if (!parsed) {
      emptyStreak += 1;
      sameCategoryStreak = 0;
      lastCategory = null;
      if (emptyStreak >= 2 && seen.size > 0) break;
    } else {
      emptyStreak = 0;
      if (parsed.category === lastCategory) {
        sameCategoryStreak += 1;
        if (sameCategoryStreak >= 2 && seen.size > 0) break;
      } else {
        sameCategoryStreak = 0;
        lastCategory = parsed.category;
      }
      seen.set(parsed.category, {
        value: parsed.value,
        raw: parsed.raw,
        hits: (seen.get(parsed.category)?.hits || 0) + 1,
        dataIndex,
      });
    }
  }

  chart.dispatchAction({ type: 'hideTip' });

  const extracted = [...seen.entries()]
    .map(([category, info]) => ({
      category,
      value: info.value,
      hits: info.hits,
      raw: info.raw,
      dataIndex: info.dataIndex,
    }))
    .sort((a, b) => a.category.localeCompare(b.category));

  return {
    ok: true,
    method: 'extension MAIN world: dispatchAction(showTip) + tooltip DOM',
    note: '未调用 getOption / 未读 series.data',
    chartDomId: chartRoot.id || null,
    extracted,
  };
}

document.getElementById('btn').addEventListener('click', async () => {
  const btn = document.getElementById('btn');
  const status = document.getElementById('status');
  const out = document.getElementById('out');
  btn.disabled = true;
  status.textContent = '注入页面并扫描中…';
  out.textContent = '';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('没有活动标签页');

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: scrapeEchartsViaTooltip,
    });

    out.textContent = JSON.stringify(result, null, 2);
    if (result?.ok) {
      status.textContent = `完成：提取到 ${result.extracted?.length ?? 0} 个类目`;
    } else {
      status.textContent = `失败：${result?.error || '未知错误'}`;
    }
  } catch (e) {
    status.textContent = '执行失败';
    out.textContent = String(e?.message || e);
  } finally {
    btn.disabled = false;
  }
});
