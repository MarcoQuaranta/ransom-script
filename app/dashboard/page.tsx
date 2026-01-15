'use client';

import { useState, useEffect } from 'react';
import ProductForm from '@/components/ProductForm';
import ProductList from '@/components/ProductList';

interface Shop {
  id: string;
  name: string;
  shop: string;
}

export default function Dashboard() {
  const [shops, setShops] = useState<Shop[]>([]);
  const [selectedShop, setSelectedShop] = useState<string>('');
  const [showForm, setShowForm] = useState(false);
  const [showShopConfig, setShowShopConfig] = useState(false);
  const [editingProduct, setEditingProduct] = useState<any>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [shopConfig, setShopConfig] = useState({
    name: '',
    shopDomain: '',
    accessToken: '',
  });
  const [configLoading, setConfigLoading] = useState(false);

  useEffect(() => {
    loadShops();
  }, []);

  const loadShops = async () => {
    try {
      const res = await fetch('/api/shops');
      const data = await res.json();
      if (data.shops) {
        setShops(data.shops);
        if (data.shops.length > 0 && !selectedShop) {
          setSelectedShop(data.shops[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to load shops:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddShop = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfigLoading(true);

    try {
      const res = await fetch('/api/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shopConfig),
      });

      const data = await res.json();

      if (res.ok) {
        setShopConfig({ name: '', shopDomain: '', accessToken: '' });
        setShowShopConfig(false);
        await loadShops();
        setSelectedShop(data.shop.id);
        setSyncResult(data.message);
      } else {
        alert(`Errore: ${data.error}`);
      }
    } catch (error) {
      console.error('Add shop error:', error);
      alert('Errore durante la configurazione');
    } finally {
      setConfigLoading(false);
    }
  };

  const handleDeleteShop = async (shopId: string) => {
    if (!confirm('Sei sicuro di voler eliminare questo shop?')) return;

    try {
      const res = await fetch(`/api/shops?id=${shopId}`, { method: 'DELETE' });
      if (res.ok) {
        await loadShops();
        if (selectedShop === shopId) {
          setSelectedShop('');
        }
      }
    } catch (error) {
      console.error('Delete shop error:', error);
    }
  };

  const syncTemplates = async () => {
    if (!selectedShop) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/sync-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopId: selectedShop }),
      });
      const data = await res.json();
      setSyncResult(res.ok ? data.message : `Errore: ${data.error}`);
    } catch (err: any) {
      setSyncResult(`Errore: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const selectedShopData = shops.find(s => s.id === selectedShop);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-600">Caricamento...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-gray-900">Landing Page Generator</h1>

            <div className="flex items-center gap-3">
              {shops.length > 0 && (
                <select
                  value={selectedShop}
                  onChange={(e) => setSelectedShop(e.target.value)}
                  className="border border-gray-300 rounded px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  {shops.map((shop) => (
                    <option key={shop.id} value={shop.id}>
                      {shop.name || shop.shop}
                    </option>
                  ))}
                </select>
              )}
              <button
                onClick={() => setShowShopConfig(!showShopConfig)}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                + Aggiungi Shop
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Shop Config Modal */}
        {showShopConfig && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold">Configura Shop</h2>
                <button
                  onClick={() => setShowShopConfig(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleAddShop} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Nome (opzionale)
                  </label>
                  <input
                    type="text"
                    value={shopConfig.name}
                    onChange={(e) => setShopConfig({ ...shopConfig, name: e.target.value })}
                    placeholder="Es: Il Mio Negozio"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Dominio Shopify *
                  </label>
                  <input
                    type="text"
                    required
                    value={shopConfig.shopDomain}
                    onChange={(e) => setShopConfig({ ...shopConfig, shopDomain: e.target.value })}
                    placeholder="tuonegozio.myshopify.com"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Access Token *
                  </label>
                  <input
                    type="password"
                    required
                    value={shopConfig.accessToken}
                    onChange={(e) => setShopConfig({ ...shopConfig, accessToken: e.target.value })}
                    placeholder="shpat_xxxxxxxxxxxxx"
                    className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Shopify Admin → Settings → Apps → Develop apps
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={configLoading}
                  className="w-full bg-blue-600 text-white py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {configLoading ? 'Verifica...' : 'Connetti'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* No shops */}
        {shops.length === 0 && !showShopConfig && (
          <div className="text-center py-16">
            <p className="text-gray-500 mb-4">Nessuno shop configurato</p>
            <button
              onClick={() => setShowShopConfig(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
            >
              Configura il tuo primo Shop
            </button>
          </div>
        )}

        {/* Main content */}
        {selectedShop && (
          <>
            {/* Shop bar */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{selectedShopData?.name || selectedShopData?.shop}</p>
                <p className="text-sm text-gray-500">{selectedShopData?.shop}</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={syncTemplates}
                  disabled={syncing}
                  className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
                >
                  {syncing ? 'Sync...' : 'Sync Templates'}
                </button>
                <button
                  onClick={() => handleDeleteShop(selectedShop)}
                  className="text-sm text-red-600 hover:text-red-800 px-2 py-1.5"
                  title="Elimina shop"
                >
                  Elimina
                </button>
              </div>
            </div>

            {/* Sync Result */}
            {syncResult && (
              <div className={`mb-4 p-3 rounded text-sm ${syncResult.startsWith('Errore') ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
                {syncResult}
              </div>
            )}

            {/* Actions */}
            <div className="mb-4">
              <button
                onClick={() => {
                  setShowForm(!showForm);
                  setEditingProduct(null);
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm hover:bg-blue-700"
              >
                {showForm ? 'Chiudi' : '+ Nuovo Prodotto'}
              </button>
            </div>

            {/* Product Form */}
            {showForm && (
              <div className="bg-white rounded-lg border border-gray-200 p-6 mb-4">
                <h2 className="text-lg font-semibold mb-4">
                  {editingProduct ? 'Modifica Prodotto' : 'Nuovo Prodotto'}
                </h2>
                <ProductForm
                  shops={shops}
                  selectedShopId={selectedShop}
                  product={editingProduct}
                  onSuccess={() => {
                    setShowForm(false);
                    setEditingProduct(null);
                  }}
                />
              </div>
            )}

            {/* Product List */}
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold mb-4">Prodotti</h2>
              <ProductList
                shopId={selectedShop}
                onEdit={(product) => {
                  setEditingProduct(product);
                  setShowForm(true);
                  // Scroll to top to show the form
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
