import DefaultTheme from 'vitepress/theme';
import { defineClientComponent } from 'vitepress';
import TwoslashFloatingVue from '@shikijs/vitepress-twoslash/client';
import '@shikijs/vitepress-twoslash/style.css';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }: { app: import('vue').App }) {
    app.use(TwoslashFloatingVue);
    // client-only: the live demos run effector + effector-vue in the browser
    app.component(
      'DevtoolsDemo',
      defineClientComponent(() => import('./components/DevtoolsDemo.vue')),
    );
    app.component(
      'DevtoolsWidget',
      defineClientComponent(() => import('./components/DevtoolsWidget.vue')),
    );
    app.component(
      'LanesDemo',
      defineClientComponent(() => import('./components/LanesDemo.vue')),
    );
    app.component(
      'InfinitePokedexDemo',
      defineClientComponent(() => import('./components/InfinitePokedexDemo.vue')),
    );
    app.component(
      'OptimisticTodosDemo',
      defineClientComponent(() => import('./components/OptimisticTodosDemo.vue')),
    );
    app.component(
      'AuthBarrierDemo',
      defineClientComponent(() => import('./components/AuthBarrierDemo.vue')),
    );
    app.component(
      'InfiniteAuthBarrierDemo',
      defineClientComponent(() => import('./components/InfiniteAuthBarrierDemo.vue')),
    );
    app.component(
      'GraphqlCountriesDemo',
      defineClientComponent(() => import('./components/GraphqlCountriesDemo.vue')),
    );
  },
};
