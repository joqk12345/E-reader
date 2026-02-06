import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { useStore } from './store/useStore';
import { useEffect } from 'react';

function App() {
  const { selectedDocumentId, loadConfig } = useStore();

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return (
    <div className="h-screen w-screen bg-gray-50">
      {selectedDocumentId ? <Reader /> : <Library />}
    </div>
  );
}

export default App;
