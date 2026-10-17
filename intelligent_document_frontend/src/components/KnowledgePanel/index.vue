<template>
  <div class="knowledge-panel">
    <div v-if="loading" v-loading="true" class="knowledge-panel__loading" />
    <p v-else-if="error" class="knowledge-panel__error">{{ error }}</p>
    <p v-else-if="!ready" class="knowledge-panel__empty">{{ t('preview.aiKnowledgeNotReady') }}</p>
    <p v-else-if="!payload" class="knowledge-panel__empty">{{ t('preview.aiKnowledgeEmpty') }}</p>
    <div v-else class="knowledge-panel__body">
      <section v-for="block in blocks" :key="block.key" class="knowledge-block">
        <h5 class="knowledge-block__title">{{ block.label }}</h5>
        <p v-if="block.kind === 'text'" class="knowledge-block__text">{{ block.value }}</p>
        <ul v-else-if="block.kind === 'list'" class="knowledge-block__list">
          <li v-for="(item, idx) in block.items" :key="idx">{{ item }}</li>
        </ul>
        <ul v-else-if="block.kind === 'findings'" class="knowledge-block__findings">
          <li v-for="(item, idx) in block.items" :key="idx" class="knowledge-finding">
            <p class="knowledge-finding__claim">{{ item.claim }}</p>
            <p v-if="item.evidence" class="knowledge-finding__meta">
              {{ t('preview.aiKnowledgeFieldEvidence') }}：{{ item.evidence }}
            </p>
            <p v-if="item.section && item.section !== 'unknown'" class="knowledge-finding__meta">
              {{ t('preview.aiKnowledgeFieldSection') }}：{{ item.section }}
            </p>
          </li>
        </ul>
        <ul v-else-if="block.kind === 'definitions'" class="knowledge-block__definitions">
          <li v-for="(item, idx) in block.items" :key="idx" class="knowledge-definition">
            <strong>{{ item.term }}</strong>
            <span> — {{ item.definition }}</span>
            <span
              v-if="item.section && item.section !== 'unknown'"
              class="knowledge-definition__section"
            >
              ({{ item.section }})
            </span>
          </li>
        </ul>
        <div v-else-if="block.kind === 'methodology'" class="knowledge-block__methodology">
          <p v-if="block.approach">
            <span class="knowledge-block__sub-label">{{ t('preview.aiKnowledgeFieldApproach') }}</span>
            {{ block.approach }}
          </p>
          <p v-if="block.dataset">
            <span class="knowledge-block__sub-label">{{ t('preview.aiKnowledgeFieldDataset') }}</span>
            {{ block.dataset }}
          </p>
          <div v-if="block.metrics.length > 0">
            <span class="knowledge-block__sub-label">{{ t('preview.aiKnowledgeFieldMetrics') }}</span>
            <ul class="knowledge-block__list">
              <li v-for="(metric, idx) in block.metrics" :key="idx">{{ metric }}</li>
            </ul>
          </div>
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
type FindingsBlock = {
  key: string
  label: string
  kind: 'findings'
  items: Array<{ claim: string; evidence: string | null; section: string }>
}
type DefinitionsBlock = {
  key: string
  label: string
  kind: 'definitions'
  items: Array<{ term: string; definition: string; section: string }>
}
type MethodologyBlock = {
  key: string
  label: string
  kind: 'methodology'
  approach: string | null
  dataset: string | null
  metrics: string[]
}
type KnowledgeBlock =
  | TextBlock
  | ListBlock
  | FindingsBlock
  | DefinitionsBlock
  | MethodologyBlock

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

const blocks = computed((): KnowledgeBlock[] => {
  const genre = props.summaryGenre
  const p = props.payload
  if (!genre || !p) return []

  const out: KnowledgeBlock[] = []
  const push = (block: KnowledgeBlock | null) => {
    if (block) out.push(block)
  }

  if (genre === 'paper') {
    push(textBlock('title', t('preview.aiKnowledgeFieldTitle'), p.title))
    push(
      textBlock(
        'researchQuestion',
        t('preview.aiKnowledgeFieldResearchQuestion'),
        p.researchQuestion,
      ),
    )
    push(listBlock('contributions', t('preview.aiKnowledgeFieldContributions'), p.contributions))

    const methodology =
      p.methodology && typeof p.methodology === 'object'
        ? (p.methodology as Record<string, unknown>)
        : null
    if (methodology) {
      const approach = asString(methodology.approach)
      const dataset = asString(methodology.dataset)
      const metrics = asStringList(methodology.metrics)
      if (approach || dataset || metrics.length > 0) {
        push({
          key: 'methodology',
          label: t('preview.aiKnowledgeFieldMethodology'),
          kind: 'methodology',
          approach,
          dataset,
          metrics,
        })
      }
    }

    const keyFindings = Array.isArray(p.keyFindings)
      ? p.keyFindings
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const claim = asString(row.claim)
            if (!claim) return null
            return {
              claim,
              evidence: asString(row.evidence),
              section: asString(row.section) ?? 'unknown',
            }
          })
          .filter((x): x is FindingsBlock['items'][number] => x != null)
      : []
    if (keyFindings.length > 0) {
      push({
        key: 'keyFindings',
        label: t('preview.aiKnowledgeFieldKeyFindings'),
        kind: 'findings',
        items: keyFindings,
      })
    }

    const definitions = Array.isArray(p.definitions)
      ? p.definitions
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const row = item as Record<string, unknown>
            const term = asString(row.term)
            const definition = asString(row.definition)
            if (!term || !definition) return null
            return {
              term,
              definition,
              section: asString(row.section) ?? 'unknown',
            }
          })
          .filter((x): x is DefinitionsBlock['items'][number] => x != null)
      : []
    if (definitions.length > 0) {
      push({
        key: 'definitions',
        label: t('preview.aiKnowledgeFieldDefinitions'),
        kind: 'definitions',
        items: definitions,
      })
    }

    push(listBlock('limitations', t('preview.aiKnowledgeFieldLimitations'), p.limitations))
    push(listBlock('futureWork', t('preview.aiKnowledgeFieldFutureWork'), p.futureWork))
    push(listBlock('keywords', t('preview.aiKnowledgeFieldKeywords'), p.keywords))
    return out
  }

  if (genre === 'lab_report') {
    push(textBlock('title', t('preview.aiKnowledgeFieldTitle'), p.title))
    push(textBlock('objective', t('preview.aiKnowledgeFieldObjective'), p.objective))
    push(listBlock('procedure', t('preview.aiKnowledgeFieldProcedure'), p.procedure))
    push(listBlock('data', t('preview.aiKnowledgeFieldData'), p.data))
    push(listBlock('analysis', t('preview.aiKnowledgeFieldAnalysis'), p.analysis))
    push(listBlock('conclusion', t('preview.aiKnowledgeFieldConclusion'), p.conclusion))
    push(listBlock('limitations', t('preview.aiKnowledgeFieldLimitations'), p.limitations))
  }

  return out
})
</script>

<style lang="scss" scoped>
.knowledge-panel {
  box-sizing: border-box;
  min-height: 100%;
  padding: 12px 14px;
}

.knowledge-panel__loading {
  min-height: 120px;
}

.knowledge-panel__error {
  margin: 0;
  font-size: 13px;
  color: var(--el-color-danger);
  line-height: 1.5;
}

.knowledge-panel__empty {
  margin: auto 0;
  text-align: center;
  font-size: 13px;
  color: var(--el-text-color-placeholder);
  line-height: 1.6;
}

.knowledge-panel__body {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.knowledge-block__title {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.knowledge-block__text {
  margin: 0;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--el-text-color-regular);
}

.knowledge-block__sub-label {
  font-weight: 600;
  color: var(--el-text-color-secondary);
  margin-right: 4px;
}

.knowledge-block__list,
.knowledge-block__findings,
.knowledge-block__definitions {
  margin: 0;
  padding-left: 1.2em;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}

.knowledge-block__methodology {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--el-text-color-regular);

  p {
    margin: 0;
  }
}

.knowledge-finding {
  margin-bottom: 8px;

  &:last-child {
    margin-bottom: 0;
  }
}

.knowledge-finding__claim {
  margin: 0 0 4px;
}

.knowledge-finding__meta {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.knowledge-definition__section {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
</style>
