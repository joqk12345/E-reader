import React, { useState } from 'react';
import { SearchPanel } from './SearchPanel';
import { SummaryPanel } from './SummaryPanel';
import { TranslatePanel } from './TranslatePanel';

type Tab = 'search' | 'summary' | 'translate';

export const ToolPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('search');

  const tabs: { key: Tab; label: string; icon: string }[] = [
    { key: 'search', label: 'Search', icon: '🔍' },
    { key: 'summary', label: 'Summary', icon: '📝' },
    { key: 'translate', label: 'Translate', icon: '🌐' },
  ];

  return (
    <div className="h-full flex flex-col bg-white border-l border-gray-200">
      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-600'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'search' && <SearchPanel />}
        {activeTab === 'summary' && <SummaryPanel />}
        {activeTab === 'translate' && <TranslatePanel />}
      </div>
    </div>
  );
};
