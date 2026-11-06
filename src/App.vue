<template>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <header class="topbar">
    <RouterLink class="brand" to="/" aria-label="半场有球雷达首页">
      <span class="brand-ball" aria-hidden="true">◉</span>
    </RouterLink>
    <nav class="primary-nav" aria-label="主导航">
      <RouterLink to="/">实时雷达</RouterLink>
      <RouterLink to="/goal-structure">20分钟有球查询</RouterLink>
      <RouterLink to="/matches">比赛查询</RouterLink>
    </nav>
  </header>
  <RouterView />
</template>
