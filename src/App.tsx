import { Library } from './components/Library';
import { Reader } from './components/Reader';
import { useStore } from './store/useStore';

function App() {
  const { selectedDocumentId } = useStore();

  return (
    <div className="h-screen w-screen bg-gray-50">
      {selectedDocumentId ? <Reader /> : <Library />}
    </div>
  );
}

export default App;
