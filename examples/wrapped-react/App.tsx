import React from 'react';

const App: React.FC = ({ serverData }) => {
  return <div><pre className="text-xl mx-auto">{JSON.stringify(serverData, null, 2)}</pre></div>
};

export default App;