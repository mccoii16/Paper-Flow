import { AppProvider, useApp } from './context/AppContext';
import { ErrorBoundary } from './components/Common/ErrorBoundary';
import { AppShell } from './components/Layout/AppShell';
import { OperatorLoginScreen } from './components/Auth/OperatorLoginScreen';
import { OverviewPage } from './components/Overview/OverviewPage';
import { InboxPage } from './components/Inbox/InboxPage';
import { AutomationsPage } from './components/Automations/AutomationsPage';
import { WorkflowBuilderPage } from './components/WorkflowBuilder/WorkflowBuilderPage';
import { ContactsPage } from './components/Contacts/ContactsPage';
import { BookingsPage } from './components/Bookings/BookingsPage';
import { AnalyticsPage } from './components/Analytics/AnalyticsPage';
import { SettingsPage } from './components/Settings/SettingsPage';

function PaperFlowContent() {
  const { activePage, session, authReady, isLoading } = useApp();

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#FAF8FB] dark:bg-[#0B1120] flex items-center justify-center p-6">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Restoring studio session...
        </div>
      </div>
    );
  }

  if (!session) {
    return <OperatorLoginScreen />;
  }

  return (
    <AppShell>
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" aria-busy="true">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="h-28 rounded-2xl border border-[#E7E4ED] dark:border-slate-800 bg-white dark:bg-[#131C31] animate-pulse"
            />
          ))}
        </div>
      ) : (
        <>
          {activePage === 'overview' && <OverviewPage />}
          {activePage === 'inbox' && <InboxPage />}
          {activePage === 'automations' && <AutomationsPage />}
          {activePage === 'builder' && <WorkflowBuilderPage />}
          {activePage === 'contacts' && <ContactsPage />}
          {activePage === 'bookings' && <BookingsPage />}
          {activePage === 'analytics' && <AnalyticsPage />}
          {activePage === 'settings' && <SettingsPage />}
        </>
      )}
    </AppShell>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppProvider>
        <PaperFlowContent />
      </AppProvider>
    </ErrorBoundary>
  );
}
