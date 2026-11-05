import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './lib/auth';
import { AppShell } from './components/AppShell';
import { LoadingState } from './components/ui/misc';

const LoginPage = lazy(() => import('./pages/login/LoginPage'));
const DashboardPage = lazy(() => import('./pages/dashboard/DashboardPage'));
const QuickEntryPage = lazy(() => import('./pages/entry/QuickEntryPage'));
const PosPage = lazy(() => import('./pages/pos/PosPage'));
const InvoicesPage = lazy(() => import('./pages/invoices/InvoicesPage'));
const InvoiceEditorPage = lazy(() => import('./pages/invoices/InvoiceEditorPage'));
const RentalsPage = lazy(() => import('./pages/rentals/RentalsPage'));
const UnitsPage = lazy(() => import('./pages/units/UnitsPage'));
const InventoryPage = lazy(() => import('./pages/inventory/InventoryPage'));
const CustomersPage = lazy(() => import('./pages/customers/CustomersPage'));
const ExpensesPage = lazy(() => import('./pages/expenses/ExpensesPage'));
const VatPage = lazy(() => import('./pages/vat/VatPage'));
const PartnersPage = lazy(() => import('./pages/partners/PartnersPage'));
const CashPage = lazy(() => import('./pages/cash/CashPage'));
const ReportsPage = lazy(() => import('./pages/reports/ReportsPage'));
const WhatsAppPage = lazy(() => import('./pages/whatsapp/WhatsAppPage'));
const ClaimsPage = lazy(() => import('./pages/claims/ClaimsPage'));
const ContractsPage = lazy(() => import('./pages/contracts/ContractsPage'));
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'));
const ImportReportPage = lazy(() => import('./pages/settings/ImportReportPage'));

function Page({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingState />}>{children}</Suspense>;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <Page>
            <LoginPage />
          </Page>
        }
      />
      <Route
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Page><DashboardPage /></Page>} />
        <Route path="entry" element={<RequireAuth roles={['ADMIN', 'STAFF']}><Page><QuickEntryPage /></Page></RequireAuth>} />
        <Route path="pos" element={<RequireAuth roles={['ADMIN', 'STAFF']}><Page><PosPage /></Page></RequireAuth>} />
        <Route path="invoices" element={<Page><InvoicesPage /></Page>} />
        <Route path="invoices/new" element={<RequireAuth roles={['ADMIN', 'STAFF']}><Page><InvoiceEditorPage /></Page></RequireAuth>} />
        <Route path="invoices/:id" element={<Page><InvoiceEditorPage /></Page>} />
        <Route path="rentals" element={<Page><RentalsPage /></Page>} />
        <Route path="units" element={<Page><UnitsPage /></Page>} />
        <Route path="inventory" element={<Page><InventoryPage /></Page>} />
        <Route path="customers" element={<Page><CustomersPage /></Page>} />
        <Route path="expenses" element={<Page><ExpensesPage /></Page>} />
        <Route path="vat" element={<Page><VatPage /></Page>} />
        <Route path="partners" element={<RequireAuth roles={['ADMIN', 'ACCOUNTANT']}><Page><PartnersPage /></Page></RequireAuth>} />
        <Route path="cash" element={<RequireAuth roles={['ADMIN', 'ACCOUNTANT']}><Page><CashPage /></Page></RequireAuth>} />
        <Route path="reports" element={<Page><ReportsPage /></Page>} />
        <Route path="whatsapp" element={<RequireAuth roles={['ADMIN']}><Page><WhatsAppPage /></Page></RequireAuth>} />
        <Route path="claims" element={<Page><ClaimsPage /></Page>} />
        <Route path="contracts" element={<RequireAuth roles={['ADMIN', 'ACCOUNTANT']}><Page><ContractsPage /></Page></RequireAuth>} />
        <Route path="settings" element={<RequireAuth roles={['ADMIN']}><Page><SettingsPage /></Page></RequireAuth>} />
        <Route path="settings/import/:batchId" element={<RequireAuth roles={['ADMIN']}><Page><ImportReportPage /></Page></RequireAuth>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
