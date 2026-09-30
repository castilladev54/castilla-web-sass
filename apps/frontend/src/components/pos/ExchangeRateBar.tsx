import { useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Button from '../atoms/Button';
import InputText from '../atoms/InputText';
import { useExchangeRateQuery, useSaveExchangeRate } from '../../hooks/queries/useExchangeRateQueries';

/**
 * ExchangeRateBar — Barra editable de tasa cambiaria USD/Bs.
 * Permite al usuario ver y actualizar la tasa del día en línea.
 * Sincroniza la tasa obtenida vía TanStack Query con el currencyStore de Zustand.
 */
const ExchangeRateBar = () => {
  const { data: rateObj, isLoading } = useExchangeRateQuery();
  const saveMutation = useSaveExchangeRate();
  const exchangeRate = rateObj?.rate ?? null;

  const [editing, setEditing] = useState(false);
  const [temp, setTemp] = useState<string | number | null>(exchangeRate);

  // Si cambia la tasa en background y no estamos editando, actualizar el temp
  useEffect(() => {
    if (!editing) {
      setTemp(exchangeRate);
    }
  }, [exchangeRate, editing]);

  const save = async () => {
    const rateNum = parseFloat(String(temp));
    if (isNaN(rateNum) || rateNum <= 0) {
      return toast.error('Ingresa una tasa válida mayor a 0');
    }

    try {
      await saveMutation.mutateAsync({ rate: String(rateNum) });
      setEditing(false);
      toast.success(`Tasa actualizada: 1 USD = ${rateNum} Bs`);
    } catch {
      toast.error('Error al actualizar la tasa en el servidor');
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 bg-gradient-to-r from-blue-500/10 to-green-500/10 border border-blue-500/20 rounded-xl px-4 py-3">
      <RefreshCw
        size={18}
        className={`text-blue-400 shrink-0 ${isLoading || saveMutation.isPending ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      <span className="text-sm text-gray-300 whitespace-nowrap">Tasa del Día:</span>

      {editing ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">1 USD =</span>
          <InputText
            type="number"
            step="0.01"
            min="0.01"
            value={temp ?? ''}
            onChange={(e) => setTemp(e.target.value)}
            disabled={saveMutation.isPending}
            className="w-28 px-3 py-1 text-sm"
            autoFocus
          />
          <span className="text-sm text-gray-400">Bs</span>
          <Button variant="primary" size="sm" onClick={save} isLoading={saveMutation.isPending}>
            Guardar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(false);
              setTemp(exchangeRate);
            }}
            disabled={saveMutation.isPending}
          >
            Cancelar
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-blue-400">1 USD = {exchangeRate} Bs</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setEditing(true);
              setTemp(exchangeRate);
            }}
            className="text-gray-300"
            disabled={isLoading}
          >
            Editar
          </Button>
        </div>
      )}
    </div>
  );
};

export default ExchangeRateBar;
