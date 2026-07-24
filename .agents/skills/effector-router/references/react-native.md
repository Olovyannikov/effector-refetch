# React Native integration (@effector/router-react-native)

Bridges @effector/router state with React Navigation native UI. Effector Router manages state
(which routes are open, params); React Navigation renders UI (animations, headers, tab bars);
the adapters sync both.

## Install

```bash
npm install @effector/router @effector/router-react-native \
  @react-navigation/native @react-navigation/stack @react-navigation/bottom-tabs
# React Navigation peer deps
npm install react-native-screens react-native-safe-area-context
```

## Import paths

- `@effector/router` — shared router API: `createRoute`, `createRouter`, `historyAdapter`.
- `@effector/router-react-native` — RN bindings: `createStackNavigator`, `createBottomTabsNavigator`,
  plus re-exported platform-neutral React bindings: `RouterProvider`, `createRouteView`,
  `createLazyRouteView`, layouts, route hooks.
- Browser-only `Link`, `useLink`, `LinkProps` stay in `@effector/router-react` (NOT re-exported).
- `@react-navigation/native` — app-owned `NavigationContainer`, `createNavigationContainerRef`.

## Setup pattern (adapter boundary)

The app owns the Router, `NavigationContainer`, and `navigationRef`. The binding never creates a
container, Router, or history adapter — it only connects existing ones. Pass the SAME ref to both
`NavigationContainer` and the component returned by the factory.

```tsx
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { createRoute, createRouter } from '@effector/router';
import { createRouteView, RouterProvider, createStackNavigator } from '@effector/router-react-native';

const homeRoute = createRoute({ path: '/home' });
const detailsRoute = createRoute({ path: '/details/:id' });
const router = createRouter({ routes: [homeRoute, detailsRoute] });

const HomeScreen = createRouteView({ route: homeRoute, view: () => <Text>Home</Text> });
const DetailsScreen = createRouteView({
  route: detailsRoute,
  view: () => {
    const params = useUnit(detailsRoute.$params);
    return <Text>Details: {params.id}</Text>;
  },
});

const StackNavigator = createStackNavigator({
  router,
  routes: [HomeScreen, DetailsScreen],
  screenOptions: { headerStyle: { backgroundColor: '#f4511e' } },
});
const navigationRef = createNavigationContainerRef();

export default function App() {
  return (
    <RouterProvider router={router}>
      <NavigationContainer ref={navigationRef}>
        <StackNavigator navigationRef={navigationRef} />
      </NavigationContainer>
    </RouterProvider>
  );
}
```

Navigate ONLY via effector router, never `navigation.navigate(...)`:

```tsx
homeRoute.open();
detailsRoute.open({ params: { id: '123' } });
homeRoute.open({ query: { tab: 'settings' } });
profileRoute.open({ replace: true }); // preserved as native stack replace
```

## createStackNavigator(config)

Returns the navigator component directly; render it with required prop `navigationRef`.

Config keys:

- `router` (required) — Router from `createRouter`.
- `routes` (required) — array of route views from `createRouteView` / `createLazyRouteView`.
- `screenOptions` — applied to all screens; accepts all React Navigation Stack options
  (`headerShown`, `headerTitle`, `headerStyle`, `headerTintColor`, `headerTitleStyle`,
  `gestureEnabled`, `gestureDirection`, `cardStyle`, `presentation: 'card' | 'modal' | 'transparentModal'`,
  `animationEnabled`, ...).
- `initialRouteName` — complete registered path template (e.g. `'/home'`). May only reference a
  route whose required path params can be omitted; parameterized routes must be opened by Router
  with real params.

Per-screen options: spread the route view and add `options` (native Stack option object or
callback); passed directly to `Stack.Screen`, NOT merged with `screenOptions`:

```tsx
routes: [{ ...ProfileScreen, options: ({ route }) => ({ title: route.name }) }];
```

## createBottomTabsNavigator(config)

Same shape and prop: `router` (required), `routes` (required), `screenOptions`, `initialRouteName`;
render result with `navigationRef`. `screenOptions` accepts all Bottom Tabs options
(`tabBarActiveTintColor`, `tabBarInactiveTintColor`, `tabBarActiveBackgroundColor`,
`tabBarInactiveBackgroundColor`, `tabBarStyle`, `tabBarLabelStyle`, `tabBarIconStyle`,
`tabBarIcon: ({ color, size, focused }) => ...`, `tabBarBadge`, `tabBarBadgeStyle`,
`tabBarShowLabel`, ...). `screenOptions` can be a callback `({ route }) => options` — use
`route.name` (the path template, e.g. `'/home'`) to pick per-tab icons.

Per-tab options: `{ ...HomeScreen, options: { tabBarLabel: 'Home' } }` — passed to `Tab.Screen`.

Tab presses prevent native selection and open the selected route through Router
(tap -> tab press -> Router opens route -> UI updates).

## Sync semantics

- Router state is the source of truth. Router-to-native sync is readiness-gated: before the ref is
  ready only the latest Router target is retained, no native command is sent; once ready the
  binding navigates with route params and preserves `replace` intent.
- Native state notifications are treated as complete snapshots; binding-originated updates are not
  echoed back (echo suppression).
- Native focus, removal/back events, completed closing gestures/transitions, and tab presses are
  translated into existing Router `open`/`close` events; the removal handler prevents the native
  action until Router state syncs back. Callbacks are bound to the rendered Effector scope.
- Listeners are subscribed to native `ready`/`state` notifications and cleaned up on unmount; an
  already-ready ref is handled.

## Pitfalls

- Screen names are complete registered path templates including parent segments
  (e.g. `/users/:userId/settings`); there is no positional/index fallback.
- `initialRouteName` cannot select a route with required path params — open it via Router instead.
- Bottom Tabs accept ONLY routes without path parameters (including optional params). Use a Stack
  navigator or Router-driven screen for parameterized routes.
- Do not use React Navigation's `navigation` prop for navigation; all navigation goes through
  route events (`route.open()` etc.).
- Per-screen `options` are not merged with `screenOptions` — they replace at Screen level.
- Deep linking, persistence, time-travel debugging, and gesture-specific flows are outside the
  adapter's documented contract; configure them directly in the native app layer if needed.
- Route params are type-inferred from the path template and are strings:
  `createRoute({ path: '/user/:id/:tab' })` gives `Route<{ id: string; tab: string }>`.
