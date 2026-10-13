import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { X, Ruler, Check, Trash2, Layers, Info, Zap } from 'lucide-react';
import { base44 } from '@/api/base44Client';

const CATEGORIES = [
    { value: 'Roof', label: 'Roof / Shingles', unit: 'sq ft', itemCodes: ['COMP_SHINGLE_RFG', 'IMPACT_RESIST_SHINGLE'] },
    { value: 'Gutter', label: 'Gutter / Fascia', unit: 'lin ft', itemCodes: ['GUTTER_5IN', 'GUTTER_6IN'] },
    { value: 'Siding', label: 'Siding / Wall', unit: 'sq ft', itemCodes: ['VINYL_SIDING', 'HARDIE_SIDING'] },
    { value: 'Interior', label: 'Interior', unit: 'sq ft', itemCodes: [] },
    { value: 'Other', label: 'Other', unit: 'ft', itemCodes: [] },
];

const UNITS = ['ft', 'in', 'sq ft', 'lin ft', 'm', 'cm'];

const ARMeasureMode = ({ videoRef, jobId, companyId, onSave, onClose }) => {
    const overlayRef = useRef(null);
    const svgRef = useRef(null);

    const [points, setPoints] = useState([]);
    const [lines, setLines] = useState([]);
    const [pendingLine, setPendingLine] = useState(null);
    const [hoverPoint, setHoverPoint] = useState(null);
    const [showInputPanel, setShowInputPanel] = useState(false);
    const [measureValue, setMeasureValue] = useState('');
    const [measureUnit, setMeasureUnit] = useState('ft');
    const [measureCategory, setMeasureCategory] = useState('Roof');
    const [measureLabel, setMeasureLabel] = useState('');
    const [priceListItems, setPriceListItems] = useState([]);
    const [showSyncPanel, setShowSyncPanel] = useState(false);
    const [selectedItemId, setSelectedItemId] = useState('');
    const [syncSuccess, setSyncSuccess] = useState(false);
    const [arSupported, setArSupported] = useState(null);
    const [arSession, setArSession] = useState(null);
    const [step, setStep] = useState('draw'); // draw | input | sync

    useEffect(() => {
        const checkAR = async () => {
            if (navigator.xr) {
                try {
                    const supported = await navigator.xr.isSessionSupported('immersive-ar');
                    setArSupported(supported);
                } catch {
                    setArSupported(false);
                }
            } else {
                setArSupported(false);
            }
        };
        checkAR();
    }, []);

    useEffect(() => {
        if (!companyId) return;
        base44.entities.PriceListItem.filter({ company_id: companyId, is_active: true }, '-created_date', 200)
            .then(items => setPriceListItems(items || []))
            .catch(() => {});
    }, [companyId]);

    const getOverlayRect = () => overlayRef.current?.getBoundingClientRect() || { left: 0, top: 0, width: 1, height: 1 };

    const toSVGPoint = (clientX, clientY) => {
        const rect = getOverlayRect();
        return {
            x: ((clientX - rect.left) / rect.width) * 100,
            y: ((clientY - rect.top) / rect.height) * 100,
        };
    };

    const handleOverlayClick = (e) => {
        if (step !== 'draw') return;
        const pt = toSVGPoint(e.clientX, e.clientY);

        if (points.length === 0) {
            setPoints([pt]);
        } else if (points.length === 1) {
            const newLine = { p1: points[0], p2: pt, id: Date.now() };
            setPendingLine(newLine);
            setPoints([]);
            setStep('input');
            setShowInputPanel(true);
        }
    };

    const handleMouseMove = (e) => {
        if (step !== 'draw') return;
        const pt = toSVGPoint(e.clientX, e.clientY);
        setHoverPoint(pt);
    };

    const handleTouchStart = (e) => {
        if (step !== 'draw') return;
        e.preventDefault();
        const touch = e.touches[0];
        const pt = toSVGPoint(touch.clientX, touch.clientY);

        if (points.length === 0) {
            setPoints([pt]);
        } else if (points.length === 1) {
            const newLine = { p1: points[0], p2: pt, id: Date.now() };
            setPendingLine(newLine);
            setPoints([]);
            setStep('input');
            setShowInputPanel(true);
        }
    };

    const handleConfirmMeasurement = () => {
        if (!pendingLine || !measureValue) return;
        const cat = CATEGORIES.find(c => c.value === measureCategory) || CATEGORIES[0];
        const finalLine = {
            ...pendingLine,
            value: parseFloat(measureValue),
            unit: measureUnit,
            category: measureCategory,
            label: measureLabel || `${measureCategory} measurement`,
        };
        setLines(prev => [...prev, finalLine]);
        setPendingLine(null);
        setShowInputPanel(false);

        const categoryHasItems = cat.itemCodes.length > 0 && priceListItems.some(
            item => cat.itemCodes.some(code => item.item_code?.toUpperCase().includes(code) || item.name?.toUpperCase().includes(code))
        );

        if (categoryHasItems) {
            setStep('sync');
            setShowSyncPanel(true);
        } else {
            commitSave([...lines, finalLine]);
            setStep('draw');
        }
    };

    const commitSave = async (allLines) => {
        if (onSave) onSave(allLines);
        if (jobId) {
            try {
                localStorage.setItem(`ar_measurements_${jobId}`, JSON.stringify(allLines));
            } catch (e) {}
        }
    };

    const handleSyncToItems = async () => {
        if (!selectedItemId || !measureValue) return;
        try {
            const item = priceListItems.find(i => i.id === selectedItemId);
            if (item) {
                const newQty = parseFloat(item.quantity || 0) + parseFloat(measureValue);
                await base44.entities.PriceListItem.update(selectedItemId, { quantity: newQty });
                setSyncSuccess(true);
                setTimeout(() => {
                    setSyncSuccess(false);
                    setShowSyncPanel(false);
                    commitSave(lines);
                    setStep('draw');
                    setMeasureValue('');
                    setMeasureLabel('');
                }, 1500);
            }
        } catch (e) {
            console.warn('Sync to items error:', e);
        }
    };

    const handleSkipSync = () => {
        commitSave(lines);
        setShowSyncPanel(false);
        setStep('draw');
        setMeasureValue('');
        setMeasureLabel('');
    };

    const handleDeleteLine = (id) => {
        setLines(prev => prev.filter(l => l.id !== id));
    };

    const selectedCategory = CATEGORIES.find(c => c.value === measureCategory) || CATEGORIES[0];

    const relevantItems = priceListItems.filter(item =>
        selectedCategory.itemCodes.some(code =>
            item.item_code?.toUpperCase().includes(code) || item.name?.toUpperCase().includes(code)
        )
    );

    const lineColor = (cat) => {
        const map = { Roof: '#f59e0b', Gutter: '#3b82f6', Siding: '#10b981', Interior: '#8b5cf6', Other: '#f87171' };
        return map[cat] || '#ffffff';
    };

    return (
        <div
            ref={overlayRef}
            className="fixed inset-0 z-[200] bg-black/10 overflow-hidden"
            style={{ cursor: step === 'draw' ? (points.length === 1 ? 'crosshair' : 'crosshair') : 'default', touchAction: 'none' }}
            onClick={handleOverlayClick}
            onMouseMove={handleMouseMove}
            onTouchStart={handleTouchStart}
        >
            {/* SVG drawing layer */}
            <svg
                ref={svgRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
            >
                {/* Grid guide lines */}
                {step === 'draw' && (
                    <>
                        <line x1="33" y1="0" x2="33" y2="100" stroke="rgba(255,255,255,0.12)" strokeWidth="0.15" />
                        <line x1="66" y1="0" x2="66" y2="100" stroke="rgba(255,255,255,0.12)" strokeWidth="0.15" />
                        <line x1="0" y1="33" x2="100" y2="33" stroke="rgba(255,255,255,0.12)" strokeWidth="0.15" />
                        <line x1="0" y1="66" x2="100" y2="66" stroke="rgba(255,255,255,0.12)" strokeWidth="0.15" />
                    </>
                )}

                {/* Saved measurement lines */}
                {lines.map(line => {
                    const color = lineColor(line.category);
                    const mx = (line.p1.x + line.p2.x) / 2;
                    const my = (line.p1.y + line.p2.y) / 2;
                    return (
                        <g key={line.id}>
                            <line
                                x1={line.p1.x} y1={line.p1.y}
                                x2={line.p2.x} y2={line.p2.y}
                                stroke={color}
                                strokeWidth="0.5"
                                strokeDasharray="2,1"
                            />
                            <circle cx={line.p1.x} cy={line.p1.y} r="1" fill={color} />
                            <circle cx={line.p2.x} cy={line.p2.y} r="1" fill={color} />
                            <rect x={mx - 8} y={my - 2.5} width="16" height="5" rx="1" fill="rgba(0,0,0,0.7)" />
                            <text x={mx} y={my + 1.5} textAnchor="middle" fill={color} fontSize="2.5" fontWeight="bold">
                                {line.value} {line.unit}
                            </text>
                        </g>
                    );
                })}

                {/* First anchor point */}
                {points.length === 1 && (
                    <>
                        <circle cx={points[0].x} cy={points[0].y} r="1.5" fill="#fff" stroke="#22c55e" strokeWidth="0.4" />
                        {hoverPoint && (
                            <line
                                x1={points[0].x} y1={points[0].y}
                                x2={hoverPoint.x} y2={hoverPoint.y}
                                stroke="#22c55e"
                                strokeWidth="0.4"
                                strokeDasharray="1.5,1"
                                opacity="0.8"
                            />
                        )}
                    </>
                )}
            </svg>

            {/* Top bar */}
            <div
                className="absolute top-0 inset-x-0 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 to-transparent"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center gap-2">
                    <Ruler className="w-5 h-5 text-yellow-400" />
                    <span className="text-white font-semibold text-sm">AR Measure Mode</span>
                    {arSupported && (
                        <Badge className="text-[10px] bg-green-600 text-white border-0">
                            <Zap className="w-2.5 h-2.5 mr-1" />ARCore
                        </Badge>
                    )}
                </div>
                <Button
                    data-testid="button-close-ar-measure"
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/20"
                    onClick={onClose}
                >
                    <X className="w-5 h-5" />
                </Button>
            </div>

            {/* Instruction banner */}
            {step === 'draw' && (
                <div
                    className="absolute top-14 inset-x-0 flex justify-center"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="bg-black/70 backdrop-blur-sm px-4 py-2 rounded-full text-white text-xs flex items-center gap-2">
                        <Info className="w-3.5 h-3.5 text-yellow-400" />
                        {points.length === 0
                            ? 'Tap to set the START point of your measurement'
                            : 'Tap to set the END point of your measurement'}
                    </div>
                </div>
            )}

            {/* Measurement input panel */}
            {step === 'input' && showInputPanel && (
                <div
                    className="absolute bottom-0 inset-x-0 bg-gray-900/95 backdrop-blur-md rounded-t-2xl p-5 space-y-4"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex items-center justify-between">
                        <h3 className="text-white font-semibold text-base flex items-center gap-2">
                            <Ruler className="w-4 h-4 text-yellow-400" />
                            Enter Measurement
                        </h3>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-gray-400 hover:text-white"
                            onClick={() => { setStep('draw'); setShowInputPanel(false); setPendingLine(null); setPoints([]); }}
                        >
                            Cancel
                        </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs text-gray-400 mb-1 block">Real-world distance</label>
                            <Input
                                data-testid="input-measure-value"
                                type="number"
                                placeholder="e.g. 24"
                                value={measureValue}
                                onChange={e => setMeasureValue(e.target.value)}
                                className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
                                autoFocus
                            />
                        </div>
                        <div>
                            <label className="text-xs text-gray-400 mb-1 block">Unit</label>
                            <Select value={measureUnit} onValueChange={setMeasureUnit}>
                                <SelectTrigger className="bg-gray-800 border-gray-700 text-white" data-testid="select-measure-unit">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">Category</label>
                        <Select value={measureCategory} onValueChange={v => { setMeasureCategory(v); setMeasureUnit(CATEGORIES.find(c => c.value === v)?.unit || 'ft'); }}>
                            <SelectTrigger className="bg-gray-800 border-gray-700 text-white" data-testid="select-measure-category">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    <div>
                        <label className="text-xs text-gray-400 mb-1 block">Label (optional)</label>
                        <Input
                            data-testid="input-measure-label"
                            placeholder="e.g. North wall height, Front gutter run"
                            value={measureLabel}
                            onChange={e => setMeasureLabel(e.target.value)}
                            className="bg-gray-800 border-gray-700 text-white placeholder:text-gray-500"
                        />
                    </div>

                    <Button
                        data-testid="button-confirm-measurement"
                        className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-semibold"
                        disabled={!measureValue}
                        onClick={handleConfirmMeasurement}
                    >
                        <Check className="w-4 h-4 mr-2" />
                        Confirm — {measureValue || '?'} {measureUnit} ({measureCategory})
                    </Button>
                </div>
            )}

            {/* Items & Pricing sync panel */}
            {step === 'sync' && showSyncPanel && (
                <div
                    className="absolute bottom-0 inset-x-0 bg-gray-900/95 backdrop-blur-md rounded-t-2xl p-5 space-y-4"
                    onClick={e => e.stopPropagation()}
                >
                    <div className="flex items-center gap-2">
                        <Layers className="w-5 h-5 text-blue-400" />
                        <h3 className="text-white font-semibold text-base">Sync to Items & Pricing?</h3>
                    </div>

                    <p className="text-gray-400 text-xs">
                        Your measurement of <strong className="text-white">{lines[lines.length - 1]?.value} {lines[lines.length - 1]?.unit}</strong> can be added
                        to an item quantity in your price list.
                    </p>

                    {syncSuccess ? (
                        <div className="flex items-center justify-center gap-2 py-4 text-green-400">
                            <Check className="w-5 h-5" />
                            <span className="font-semibold">Item updated!</span>
                        </div>
                    ) : (
                        <>
                            {relevantItems.length > 0 ? (
                                <div>
                                    <label className="text-xs text-gray-400 mb-1 block">Select item to update quantity</label>
                                    <Select value={selectedItemId} onValueChange={setSelectedItemId}>
                                        <SelectTrigger className="bg-gray-800 border-gray-700 text-white" data-testid="select-sync-item">
                                            <SelectValue placeholder="Choose an item..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {relevantItems.map(item => (
                                                <SelectItem key={item.id} value={item.id}>
                                                    {item.item_code} — {item.name} (current: {item.quantity || 0} {item.unit || ''})
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ) : (
                                <p className="text-xs text-gray-500 italic">No matching items found in your price list for this category.</p>
                            )}

                            <div className="flex gap-3">
                                {relevantItems.length > 0 && (
                                    <Button
                                        data-testid="button-sync-to-items"
                                        className="flex-1 bg-blue-600 hover:bg-blue-500 text-white"
                                        disabled={!selectedItemId}
                                        onClick={handleSyncToItems}
                                    >
                                        <Layers className="w-4 h-4 mr-2" />
                                        Add to Item
                                    </Button>
                                )}
                                <Button
                                    data-testid="button-skip-sync"
                                    variant="outline"
                                    className="flex-1 border-gray-700 text-gray-300 hover:bg-gray-800"
                                    onClick={handleSkipSync}
                                >
                                    Skip for now
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Bottom toolbar — saved measurements list */}
            {lines.length > 0 && step === 'draw' && (
                <div
                    className="absolute bottom-0 inset-x-0 bg-black/80 backdrop-blur-sm px-4 py-3"
                    onClick={e => e.stopPropagation()}
                >
                    <p className="text-gray-400 text-xs mb-2">Saved measurements ({lines.length})</p>
                    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                        {lines.map(line => (
                            <div key={line.id} className="flex-shrink-0 flex items-center gap-1.5 bg-gray-800 rounded-full px-3 py-1.5 text-xs">
                                <span style={{ color: lineColor(line.category) }} className="font-bold">{line.value} {line.unit}</span>
                                <span className="text-gray-400">{line.label || line.category}</span>
                                <button className="text-gray-600 hover:text-red-400 ml-1" onClick={() => handleDeleteLine(line.id)}>
                                    <Trash2 className="w-3 h-3" />
                                </button>
                            </div>
                        ))}
                    </div>
                    <Button
                        data-testid="button-done-measure"
                        className="w-full mt-2 bg-green-600 hover:bg-green-500 text-white"
                        size="sm"
                        onClick={() => { commitSave(lines); onClose(); }}
                    >
                        <Check className="w-4 h-4 mr-2" />
                        Done — Save All Measurements
                    </Button>
                </div>
            )}
        </div>
    );
};

export default ARMeasureMode;
