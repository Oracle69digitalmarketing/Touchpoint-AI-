import React, { useCallback, useEffect, useState } from 'react';
import {
  Plus, Package, Loader2, Pencil, Trash2, X, AlertTriangle, Check, CalendarClock, Power,
} from 'lucide-react';
import { Product, PRODUCT_CURRENCIES, PRODUCT_STATUSES, ProductStatus } from '../types';
import { productService, ApiError } from '../services/products';
import BookingConfigModal from './BookingConfigModal';

interface Props {
  onNavigate?: (tab: string) => void;
}

type FormState = {
  name: string;
  category: string;
  description: string;
  price: string;
  currency: string;
  status: ProductStatus;
  bookable: boolean;
};

const emptyForm: FormState = {
  name: '',
  category: '',
  description: '',
  price: '',
  currency: 'NGN',
  status: 'active',
  bookable: false,
};

const ProductCatalog: React.FC<Props> = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [bookingProductId, setBookingProductId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await productService.list();
      setProducts(list);
    } catch (err: any) {
      setError(err?.message || 'Could not load the product catalog.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setSuccess(msg);
    window.setTimeout(() => setSuccess(null), 3000);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setFieldErrors({});
    setFormOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setForm({
      name: product.name,
      category: product.category || '',
      description: product.description || '',
      price: String(product.price),
      currency: product.currency,
      status: product.status,
      bookable: product.bookable,
    });
    setFormError(null);
    setFieldErrors({});
    setFormOpen(true);
  };

  const validateForm = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Product/service name is required';
    else if (form.name.trim().length > 120) errs.name = 'Name must be 120 characters or fewer';
    if (form.category && form.category.trim().length > 100) errs.category = 'Category must be 100 characters or fewer';
    if (form.description && form.description.length > 2000) errs.description = 'Description must be 2000 characters or fewer';
    const price = Number(form.price);
    if (form.price.trim() === '' || !Number.isFinite(price)) errs.price = 'price must be a number';
    else if (price < 0 || price > 999999999999.99) errs.price = 'price must be between 0 and 999999999999.99';
    return errs;
  };

  const handleSubmit = async () => {
    if (saving) return;
    const local = validateForm();
    setFieldErrors(local);
    if (Object.keys(local).length > 0) return;

    setSaving(true);
    setFormError(null);
    const input = {
      name: form.name.trim(),
      description: form.description.trim() === '' ? null : form.description.trim(),
      category: form.category.trim() === '' ? null : form.category.trim(),
      price: Number(form.price),
      currency: form.currency as Product['currency'],
      status: form.status,
      ...(editing ? { bookable: form.bookable } : {}),
    };
    try {
      if (editing) {
        const updated = await productService.update(editing.id, input);
        setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
        flash(`"${updated.name}" saved.`);
      } else {
        const created = await productService.create(input);
        setProducts((prev) => [...prev, created]);
        flash(`"${created.name}" added to the catalog.`);
      }
      setFormOpen(false);
    } catch (err: any) {
      if (err instanceof ApiError && err.fields) {
        setFieldErrors(err.fields);
      }
      setFormError(err?.message || 'Could not save the product.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (product: Product) => {
    if (deletingId) return;
    if (!confirm(`Delete "${product.name}" from the catalog?`)) return;
    setDeletingId(product.id);
    setError(null);
    try {
      await productService.remove(product.id);
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      flash(`"${product.name}" deleted.`);
    } catch (err: any) {
      setError(err?.message || 'Could not delete the product.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleBookable = async (product: Product) => {
    if (togglingId) return;
    setTogglingId(product.id);
    setError(null);
    try {
      const updated = await productService.update(product.id, { bookable: !product.bookable });
      setProducts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      flash(updated.bookable ? `"${updated.name}" is now bookable.` : `"${updated.name}" is no longer bookable.`);
    } catch (err: any) {
      setError(err?.message || 'Could not update bookable status.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleKeyDown = (e: React.FormEvent) => {
    e.preventDefault();
    handleSubmit();
  };

  const currencySymbol = (code: string) => (code === 'USD' ? '$' : code === 'EUR' ? '€' : code === 'GBP' ? '£' : code === 'JPY' ? '¥' : '₦');

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Product Catalog</h2>
          <p className="text-sm text-slate-500 font-medium">List the products and services your AI workforce sells.</p>
        </div>
        <button
          onClick={openCreate}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all active:scale-95 disabled:opacity-50"
        >
          <Plus size={18} />
          Add Product
        </button>
      </div>

      {error && (
        <div className="p-5 bg-rose-50 border border-rose-100 rounded-[24px] text-rose-700 text-sm font-bold flex items-start gap-3">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="p-5 bg-emerald-50 border border-emerald-100 rounded-[24px] text-emerald-700 text-sm font-bold flex items-center gap-3">
          <Check size={18} className="shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-100 rounded-[40px] p-16 flex flex-col items-center justify-center text-center">
          <Loader2 size={32} className="animate-spin text-indigo-600 mb-4" />
          <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Loading catalog…</p>
        </div>
      ) : products.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-[40px] p-16 flex flex-col items-center justify-center text-center">
          <div className="w-20 h-20 bg-indigo-50 text-indigo-600 rounded-3xl flex items-center justify-center mb-6">
            <Package size={40} />
          </div>
          <h3 className="text-xl font-bold text-slate-900 mb-2">No products yet</h3>
          <p className="text-slate-500 max-w-sm mb-8">Add your first product or service so your sales workforce can quote real prices.</p>
          <button onClick={openCreate} className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg active:scale-95">
            Add your first product
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {products.map((product) => (
            <div key={product.id} className="bg-white border border-slate-100 rounded-[32px] p-7 shadow-sm hover:shadow-xl transition-all duration-300">
              <div className="flex items-start justify-between mb-4 gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shrink-0">
                    <Package size={22} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-lg font-bold text-slate-900 truncate">{product.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        product.status === 'active' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
                      }`}>
                        {product.status}
                      </span>
                      {product.bookable && (
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-indigo-50 text-indigo-600">
                          Bookable
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-black text-slate-900">{currencySymbol(product.currency)}{product.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</p>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{product.currency}</p>
                </div>
              </div>

              <p className="text-sm text-slate-500 leading-relaxed mb-5 line-clamp-2 min-h-[2.5rem]">
                {product.description || (product.category ? `Category: ${product.category}` : 'No description yet.')}
              </p>
              {product.category && !product.description && (
                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest -mt-3 mb-5">{product.category}</p>
              )}

              <div className="flex flex-wrap gap-2">
                {product.bookable && (
                  <button
                    onClick={() => setBookingProductId(product.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-50"
                  >
                    <CalendarClock size={13} /> Configure Booking
                  </button>
                )}
                <button
                  onClick={() => openEdit(product)}
                  className="flex flex-1 items-center justify-center gap-1.5 py-2.5 rounded-xl text-[11px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 transition-all"
                >
                  <Pencil size={13} /> Edit
                </button>
              </div>

              <div className="flex gap-2 pt-3">
                <button
                  onClick={() => handleToggleBookable(product)}
                  disabled={togglingId === product.id}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold border transition-all disabled:opacity-50 ${
                    product.bookable
                      ? 'text-amber-600 bg-amber-50 border-amber-100 hover:bg-amber-100'
                      : 'text-indigo-600 bg-indigo-50 border-indigo-100 hover:bg-indigo-100'
                  }`}
                  title={product.bookable ? 'Make non-bookable' : 'Make bookable'}
                >
                  {togglingId === product.id ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
                  {product.bookable ? 'Disable Booking' : 'Enable Booking'}
                </button>
                <button
                  onClick={() => handleDelete(product)}
                  disabled={deletingId === product.id}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[11px] font-bold text-rose-600 bg-rose-50 border border-rose-100 hover:bg-rose-100 transition-all disabled:opacity-50"
                >
                  {deletingId === product.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CREATE / EDIT MODAL */}
      {formOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="p-8 pb-0">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{editing ? 'Edit Product' : 'Add Product'}</h2>
                  <p className="text-sm text-slate-500 font-medium">All prices are quoted exactly as stored.</p>
                </div>
                <button onClick={() => setFormOpen(false)} className="p-3 hover:bg-slate-50 rounded-full transition-colors">
                  <X size={22} className="text-slate-400" />
                </button>
              </div>
            </div>
            <form onSubmit={handleKeyDown} className="p-8 overflow-y-auto custom-scrollbar space-y-5">
              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Strategy Session"
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
                />
                {fieldErrors.name && <p className="px-1 text-xs font-bold text-rose-600">{fieldErrors.name}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Price *</label>
                  <input
                    inputMode="decimal"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    placeholder="0.00"
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
                  />
                  {fieldErrors.price && <p className="px-1 text-xs font-bold text-rose-600">{fieldErrors.price}</p>}
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Currency</label>
                  <select
                    value={form.currency}
                    onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
                    className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700 appearance-none"
                  >
                    {PRODUCT_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Category</label>
                <input
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  placeholder="e.g. Consulting"
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700"
                />
                {fieldErrors.category && <p className="px-1 text-xs font-bold text-rose-600">{fieldErrors.category}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="What the customer is buying…"
                  rows={3}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700 resize-none"
                />
                {fieldErrors.description && <p className="px-1 text-xs font-bold text-rose-600">{fieldErrors.description}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-1">Status</label>
                <select
                  value={form.status}
                  onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ProductStatus }))}
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-100 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700 appearance-none"
                >
                  {PRODUCT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                {fieldErrors.status && <p className="px-1 text-xs font-bold text-rose-600">{fieldErrors.status}</p>}
              </div>

              {editing && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, bookable: !f.bookable }))}
                  className="w-full flex items-center justify-between p-5 bg-slate-50 rounded-2xl border border-slate-100"
                >
                  <span className="text-sm font-bold text-slate-700">Call this a booking product</span>
                  <span className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.bookable ? 'bg-indigo-600' : 'bg-slate-300'}`}>
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${form.bookable ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </span>
                </button>
              )}
              {fieldErrors.bookable && <p className="px-1 text-xs font-bold text-rose-600">{fieldErrors.bookable}</p>}

              {formError && (
                <div className="p-4 bg-rose-50 border border-rose-100 rounded-2xl text-rose-700 text-xs font-bold flex items-start gap-2">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="py-4 bg-slate-100 rounded-2xl font-bold text-slate-600 hover:bg-slate-200 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {saving && <Loader2 size={16} className="animate-spin" />}
                  {editing ? 'Save Changes' : 'Add Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {bookingProductId && (
        <BookingConfigModal
          productId={bookingProductId}
          productName={products.find((p) => p.id === bookingProductId)?.name || 'Product'}
          onClose={() => setBookingProductId(null)}
          onSaved={() => load()}
        />
      )}
    </div>
  );
};

export default ProductCatalog;