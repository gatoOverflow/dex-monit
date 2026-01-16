# @dex-monit/observability-sdk-react-native

SDK React Native pour la plateforme Dex Monitoring. Capture automatiquement les erreurs JavaScript, les promesses non gérées, et fournit des outils pour le suivi des erreurs dans vos applications mobiles.

## Installation

```bash
npm install @dex-monit/observability-sdk-react-native
# ou
yarn add @dex-monit/observability-sdk-react-native
```

## Configuration initiale

```tsx
// App.tsx ou index.js
import { init } from '@dex-monit/observability-sdk-react-native';

init({
  apiUrl: 'https://your-monitoring-api.com/api',
  apiKey: 'dex_xxxxxxxxxxxxxxxx',
  environment: 'production', // ou 'staging', 'development'
  release: '1.0.0',
  debug: __DEV__, // Active les logs en développement
});
```

## Capture automatique

Une fois initialisé, le SDK capture automatiquement :
- ✅ Erreurs JavaScript non gérées
- ✅ Promesses rejetées non gérées
- ✅ Crashes de l'application

## Error Boundary

Utilisez `DexErrorBoundary` pour capturer les erreurs React :

```tsx
import { DexErrorBoundary } from '@dex-monit/observability-sdk-react-native';
import { View, Text } from 'react-native';

function App() {
  return (
    <DexErrorBoundary
      fallback={
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Text>Une erreur est survenue</Text>
        </View>
      }
      onError={(error, errorInfo, eventId) => {
        console.log('Erreur capturée:', eventId);
      }}
    >
      <MyApp />
    </DexErrorBoundary>
  );
}
```

### HOC Alternative

```tsx
import { withDexErrorBoundary } from '@dex-monit/observability-sdk-react-native';

const SafeMyScreen = withDexErrorBoundary(MyScreen, {
  fallback: <Text>Erreur de chargement</Text>,
});
```

## Capture manuelle

### Capturer une exception

```tsx
import { captureException } from '@dex-monit/observability-sdk-react-native';

try {
  await riskyOperation();
} catch (error) {
  captureException(error, {
    // Contexte additionnel
    userId: '123',
    action: 'checkout',
  });
}
```

### Capturer un message

```tsx
import { captureMessage } from '@dex-monit/observability-sdk-react-native';

// Niveaux : 'DEBUG', 'INFO', 'WARNING', 'ERROR'
captureMessage('Utilisateur a complété le onboarding', 'INFO', {
  step: 'final',
});
```

## Contexte utilisateur

```tsx
import { setUser } from '@dex-monit/observability-sdk-react-native';

// Après connexion
setUser({
  id: user.id,
  email: user.email,
  username: user.username,
  // Données personnalisées
  plan: 'premium',
});

// Après déconnexion
setUser(null);
```

## Breadcrumbs

Les breadcrumbs tracent les actions menant à une erreur :

```tsx
import { addBreadcrumb } from '@dex-monit/observability-sdk-react-native';

// Navigation
addBreadcrumb({
  type: 'navigation',
  category: 'navigation',
  message: 'Navigué vers ProfileScreen',
});

// Action utilisateur
addBreadcrumb({
  type: 'user',
  category: 'ui.click',
  message: 'Bouton "Acheter" cliqué',
  data: { productId: '456' },
});

// Requête HTTP
addBreadcrumb({
  type: 'http',
  category: 'http',
  message: 'GET /api/products',
  level: 'info',
  data: { status: 200, duration: 150 },
});
```

## Tags

```tsx
import { setTag, setTags } from '@dex-monit/observability-sdk-react-native';

// Tag unique
setTag('feature', 'checkout');

// Tags multiples
setTags({
  feature: 'checkout',
  variant: 'A',
});
```

## Hooks React

### useDexError

```tsx
import { useDexError } from '@dex-monit/observability-sdk-react-native';

function MyComponent() {
  const captureError = useDexError({ screen: 'HomeScreen' });

  const handlePress = async () => {
    try {
      await fetchData();
    } catch (error) {
      captureError(error);
    }
  };

  return <Button onPress={handlePress} title="Fetch" />;
}
```

### useDexCapture

```tsx
import { useDexCapture } from '@dex-monit/observability-sdk-react-native';

function MyComponent() {
  const dex = useDexCapture({ screen: 'ProfileScreen' });

  const handleSave = () => {
    dex.breadcrumb('Save button clicked', 'ui.click');
    
    try {
      saveProfile();
      dex.message('Profile saved', 'INFO');
    } catch (err) {
      dex.error(err);
    }
  };

  return <Button onPress={handleSave} title="Save" />;
}
```

### useDexScreenView

```tsx
import { useDexScreenView } from '@dex-monit/observability-sdk-react-native';

function ProfileScreen() {
  useDexScreenView('ProfileScreen', { userId: '123' });

  return <View>...</View>;
}
```

### useDexNavigation (React Navigation)

```tsx
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { useDexNavigation } from '@dex-monit/observability-sdk-react-native';

function App() {
  const navigationRef = useNavigationContainerRef();
  useDexNavigation(navigationRef);

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator>
        {/* screens */}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

### useDexAction

```tsx
import { useDexAction } from '@dex-monit/observability-sdk-react-native';

function CheckoutScreen() {
  const trackAction = useDexAction('CheckoutScreen');

  return (
    <Button 
      onPress={() => {
        trackAction('purchase_clicked', { total: 99.99 });
        handlePurchase();
      }}
      title="Acheter"
    />
  );
}
```

### useDexUser

```tsx
import { useDexUser } from '@dex-monit/observability-sdk-react-native';

function AuthProvider({ children }) {
  const { user } = useAuth();
  
  useDexUser(user ? { id: user.id, email: user.email } : null);

  return children;
}
```

## Configuration avancée

```tsx
import { init } from '@dex-monit/observability-sdk-react-native';

init({
  apiUrl: 'https://your-api.com/api',
  apiKey: 'dex_xxx',
  environment: 'production',
  release: '1.0.0',
  
  // Limiter les breadcrumbs
  maxBreadcrumbs: 50,
  
  // Échantillonnage (0.5 = 50% des erreurs)
  sampleRate: 1.0,
  
  // Tags globaux
  tags: {
    app: 'my-app',
    platform: 'ios',
  },
  
  // Utilisateur initial
  user: {
    id: 'anonymous',
  },
  
  // Modifier/filtrer les événements
  beforeSend: (event) => {
    // Filtrer certaines erreurs
    if (event.message?.includes('Network request failed')) {
      return null; // Ne pas envoyer
    }
    
    // Modifier l'événement
    event.tags = { ...event.tags, processed: 'true' };
    return event;
  },
  
  // Mode debug
  debug: __DEV__,
});
```

## Device Info (optionnel)

Pour plus d'informations sur l'appareil, installez `react-native-device-info` :

```bash
npm install react-native-device-info
```

Le SDK détectera automatiquement et utilisera les informations supplémentaires.

## Logs

```tsx
import { captureLog } from '@dex-monit/observability-sdk-react-native';

captureLog('INFO', 'Application démarrée', {
  startupTime: 1500,
});

captureLog('WARNING', 'Cache expiré', {
  cacheKey: 'user_profile',
});

captureLog('ERROR', 'Échec de synchronisation', {
  reason: 'timeout',
});
```

## API Reference

| Fonction | Description |
|----------|-------------|
| `init(config)` | Initialise le SDK |
| `captureException(error, context?)` | Capture une exception |
| `captureMessage(message, level?, context?)` | Capture un message |
| `captureLog(level, message, data?)` | Envoie un log |
| `addBreadcrumb(breadcrumb)` | Ajoute un breadcrumb |
| `setUser(user)` | Définit le contexte utilisateur |
| `setTag(key, value)` | Définit un tag |
| `setTags(tags)` | Définit plusieurs tags |
| `setDeviceContext(device)` | Définit le contexte device |
| `close()` | Ferme le SDK et réinitialise l'état |

## Compatibilité

- React Native >= 0.60
- React >= 17.0.0
- iOS et Android

## Support

Pour toute question ou problème, ouvrez une issue sur le repo GitHub.
