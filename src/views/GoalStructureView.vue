<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import GoalStructureQuery from '../components/GoalStructureQuery.vue'
import type { LiveMatch, LiveResponse } from '../types'

const matches = ref<LiveMatch[]>([]); const loading = ref(true); const fetchedAt = ref('')
let timer: number | undefined; let requestInFlight = false
async function load() {
  if (requestInFlight) return
  requestInFlight = true; loading.value = true
  try {
    const response = await fetch('/api/live', { cache: 'no-store' })
    const body = await response.json() as LiveResponse
    if (response.ok) { matches.value = body.matches; fetchedAt.value = body.fetchedAt }
  } finally { loading.value = false; requestInFlight = false }
}
onMounted(() => { void load(); timer = window.setInterval(load, 120_000) })
onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template><GoalStructureQuery :matches="matches" :loading="loading" :fetched-at="fetchedAt" /></template>
