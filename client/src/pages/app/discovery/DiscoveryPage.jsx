import { useSearchParams } from 'react-router-dom';
import useDocumentTitle from '../../../hooks/useDocumentTitle.js';
import { PageHeader } from '../../../components/ui.jsx';
import WebDiscovery from './WebDiscovery.jsx';
import CsvImport from './CsvImport.jsx';
import LocalBusiness from './LocalBusiness.jsx';

const TABS = [['web', 'Web search'], ['local', 'Local businesses'], ['csv', 'CSV import']];

export default function DiscoveryPage() {
  useDocumentTitle('Discovery');
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'web';
  const setTab = (k) => setParams(k === 'web' ? {} : { tab: k }, { replace: true });
  return (
    <>
      <PageHeader title="Discovery" description="Find new leads with official search APIs, or import your own list." />
      <div className="mb-6 flex gap-1" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-lg px-3 py-2 text-sm ${tab === k ? 'bg-brand-500/15 text-brand-500' : 'text-white/60 hover:bg-white/5'}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'web' && <WebDiscovery />}
      {tab === 'local' && <LocalBusiness />}
      {tab === 'csv' && <CsvImport />}
    </>
  );
}
