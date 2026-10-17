<template>
  <div class="summary-panel">
    <div v-if="loading" v-loading="true" class="summary-panel__loading" />
    <p v-else-if="error" class="summary-panel__error">{{ error }}</p>
    <p v-else-if="!ready" class="summary-panel__empty">{{ t('preview.aiSummaryNotReady') }}</p>
    <p v-else-if="!payload" class="summary-panel__empty">{{ t('preview.aiSummaryEmpty') }}</p>
    <div v-else class="summary-panel__body">
      <section v-for="block in blocks" :key="block.key" class="summary-block">
        <h5 class="summary-block__title">{{ block.label }}</h5>
        <p v-if="block.kind === 'text'" class="summary-block__text">{{ block.value }}</p>
        <ul v-else-if="block.kind === 'list'" class="summary-block__list">
          <li v-for="(item, idx) in block.items" :key="idx">{{ item }}</li>
        </ul>
        <ul v-else-if="block.kind === 'pairs'" class="summary-block__pairs">
          <li v-for="(item, idx) in block.items" :key="idx">
            <strong>{{ item.primary }}</strong>
            <span v-if="item.secondary"> — {{ item.secondary }}</span>
          </li>
        </ul>
        <div v-else-if="block.kind === 'sections'" class="summary-block__sections">
          <article v-for="(sec, idx) in block.items" :key="idx" class="summary-section">
            <h6 class="summary-section__title">{{ sec.title }}</h6>
            <p class="summary-section__text">{{ sec.summary }}</p>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SummaryGenre } from '@api/ai'

type TextBlock = { key: string; label: string; kind: 'text'; value: string }
type ListBlock = { key: string; label: string; kind: 'list'; items: string[] }
type PairsBlock = {
  key: string
  label: string
  kind: 'pairs'
  items: Array<{ primary: string; secondary?: string }>
}
type SectionsBlock = {
  key: string
  label: string
  kind: 'sections'
  items: Array<{ title: string; summary: string }>
}
type SummaryBlock = TextBlock | ListBlock | PairsBlock | SectionsBlock

type PairItem = PairsBlock['items'][number]

const props = defineProps<{
  summaryGenre: SummaryGenre | null
  payload: Record<string, unknown> | null
  loading?: boolean
  error?: string
  ready?: boolean
}>()

const { t } = useI18n()

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

function textBlock(key: string, label: string, value: unknown): TextBlock | null {
  const text = asString(value)
  if (!text) return null
  return { key, label, kind: 'text', value: text }
}

function listBlock(key: string, label: string, value: unknown): ListBlock | null {
  const items = asStringList(value)
  if (items.length === 0) return null
  return { key, label, kind: 'list', items }
}

function toPairItem(primary: string, secondary: string | null): PairItem {
  return secondary ? { primary, secondary } : { primary }
}

function filterPairs(items: Array<PairItem | null>): PairItem[] {
  return items.filter((x): x is PairItem => x != null)
}

const blocks = computed((): SummaryBlock[] => {
  const genre = props.summaryGenre
  const p = props.payload
  if (!genre || !p) return []

  const out: SummaryBlock[] = []
  const push = (block: SummaryBlock | null) => {
    if (block) out.push(block)
  }

  if (genre === 'novel') {
    push(textBlock('oneLiner', t('preview.aiSummaryFieldOneLiner'), p.oneLiner))
    push(textBlock('overview', t('preview.aiSummaryFieldOverview'), p.overview))
    push(listBlock('plotPoints', t('preview.aiSummaryFieldPlotPoints'), p.plotPoints))
    const characters = Array.isArray(p.characters)
      ? filterPairs(
          p.characters.map((c) => {
            if (!c || typeof c !== 'object') return null
            const row = c as Record<string, unknown>
            const name = asString(row.name)
            const role = asString(row.role)
            if (!name) return null
            return toPairItem(name, role)
          }),
        )
      : []
    if (characters.length > 0) {
      out.push({
        key: 'characters',
        label: t('preview.aiSummaryFieldCharacters'),
        kind: 'pairs',
        items: characters,
      })
    }
    push(listBlock('themes', t('preview.aiSummaryFieldThemes'), p.themes))
    return out
  }

  if (genre === 'general_nonfiction') {
    push(textBlock('oneLiner', t('preview.aiSummaryFieldOneLiner'), p.oneLiner))
    push(textBlock('overview', t('preview.aiSummaryFieldOverview'), p.overview))
    push(textBlock('timeScope', t('preview.aiSummaryFieldTimeScope'), p.timeScope))
    const timeline = Array.isArray(p.timeline)
      ? filterPairs(
          p.timeline.map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const period = asString(row.period)
            const event = asString(row.event)
            if (!period && !event) return null
            return toPairItem(period ?? '', event)
          }),
        )
      : []
    if (timeline.length > 0) {
      out.push({
        key: 'timeline',
        label: t('preview.aiSummaryFieldTimeline'),
        kind: 'pairs',
        items: timeline,
      })
    }
    const keyFigures = Array.isArray(p.keyFigures)
      ? filterPairs(
          p.keyFigures.map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const name = asString(row.name)
            const significance = asString(row.significance)
            if (!name) return null
            return toPairItem(name, significance)
          }),
        )
      : []
    if (keyFigures.length > 0) {
      out.push({
        key: 'keyFigures',
        label: t('preview.aiSummaryFieldKeyFigures'),
        kind: 'pairs',
        items: keyFigures,
      })
    }
    push(
      listBlock(
        'causesAndEffects',
        t('preview.aiSummaryFieldCausesAndEffects'),
        p.causesAndEffects,
      ),
    )
    return out
  }

  if (genre === 'technical' || genre === 'textbook') {
    push(textBlock('purpose', t('preview.aiSummaryFieldPurpose'), p.purpose))
    push(textBlock('overview', t('preview.aiSummaryFieldOverview'), p.overview))
    const sections = Array.isArray(p.sections)
      ? p.sections
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const title = asString(row.title)
            const summary = asString(row.summary)
            if (!title && !summary) return null
            return { title: title ?? '', summary: summary ?? '' }
          })
          .filter((x): x is { title: string; summary: string } => x != null)
      : []
    if (sections.length > 0) {
      out.push({
        key: 'sections',
        label: t('preview.aiSummaryFieldSections'),
        kind: 'sections',
        items: sections,
      })
    }
    push(listBlock('keyPoints', t('preview.aiSummaryFieldKeyPoints'), p.keyPoints))
    push(
      listBlock('prerequisites', t('preview.aiSummaryFieldPrerequisites'), p.prerequisites),
    )
    return out
  }

  // lab_report / paper
  push(
    textBlock('researchQuestion', t('preview.aiSummaryFieldResearchQuestion'), p.researchQuestion),
  )
  push(textBlock('method', t('preview.aiSummaryFieldMethod'), p.method))
  push(listBlock('keyFindings', t('preview.aiSummaryFieldKeyFindings'), p.keyFindings))
  push(listBlock('conclusions', t('preview.aiSummaryFieldConclusions'), p.conclusions))
  push(listBlock('limitations', t('preview.aiSummaryFieldLimitations'), p.limitations))
  if (genre === 'paper') {
    push(listBlock('contributions', t('preview.aiSummaryFieldContributions'), p.contributions))
    push(textBlock('relatedWork', t('preview.aiSummaryFieldRelatedWork'), p.relatedWork))
    push(textBlock('futureWork', t('preview.aiSummaryFieldFutureWork'), p.futureWork))
  }
  return out
})
</script>

<style lang="scss" scoped>
.summary-panel {
  box-sizing: border-box;
  min-height: 100%;
  padding: 12px 14px;
}

.summary-panel__loading {
  min-height: 120px;
}

.summary-panel__error {
  margin: 0;
  font-size: 13px;
  color: var(--el-color-danger);
  line-height: 1.5;
}

.summary-panel__empty {
  margin: auto 0;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  line-height: 1.6;
}

.summary-panel__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.summary-block__title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.summary-block__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--el-text-color-regular);
}

.summary-block__list,
.summary-block__pairs {
  margin: 0;
  padding-left: 1.2em;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.summary-block__sections {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.summary-section__title {
  margin: 0 0 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.summary-section__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--el-text-color-regular);
}
</style>
