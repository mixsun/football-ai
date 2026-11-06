import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'radar', component: () => import('./views/HomeView.vue') },
    { path: '/goal-structure', name: 'goal-structure', component: () => import('./views/GoalStructureView.vue') },
    { path: '/matches', name: 'matches', component: () => import('./views/MatchQueryView.vue') },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

export default router
