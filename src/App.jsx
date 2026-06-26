import React, { useState, useMemo, useEffect } from 'react';
import { Search, Map, Info, Package, Layers, Save, X, Plus, Settings, GripVertical, AlertTriangle, Building2, ChevronDown, ArrowRightLeft } from 'lucide-react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';

export default function App() {
  const [inventory, setInventory] = useState([]);
  const [appConfig, setAppConfig] = useState({ almacenes: [], floors: [], aisles: [] });
  const [selectedAlmacenId, setSelectedAlmacenId] = useState(null);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [quickAssignAisle, setQuickAssignAisle] = useState(null);
  const [loadingAction, setLoadingAction] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isAlmacenSelectorOpen, setIsAlmacenSelectorOpen] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState([]);
  const [confirmDeleteDialog, setConfirmDeleteDialog] = useState(null);
  const [transferDialog, setTransferDialog] = useState(null); // { items: [{_uid, qty}], sourceAlmacenId }

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = () => {
    Promise.all([
      fetch('/api/config').then(res => res.json()),
      fetch('/api/inventory').then(res => res.json())
    ])
      .then(([configData, invData]) => {
        setAppConfig(configData);
        if (configData.almacenes && configData.almacenes.length > 0) {
          setSelectedAlmacenId(configData.almacenes[0].id);
        }
        setInventory(invData);
        setIsDataLoaded(true);
      })
      .catch(err => {
        console.error(err);
        alert("Error cargando datos. Asegúrate de que el servidor local (Node) esté corriendo.");
      });
  };

  const csvColumns = useMemo(() => {
    if (inventory.length === 0) return [];
    return Object.keys(inventory[0]).filter(k => k !== '_uid' && k !== 'Ubicaciones_App');
  }, [inventory]);

  const parseLocations = (locStr, configFloors, configAisles) => {
    if (!locStr) return [];
    return locStr.split('|').map(part => {
      const [pasilloRaw, qty] = part.split(':');
      if (!pasilloRaw) return null;
      let pasillo = pasilloRaw.trim();
      const parts = pasillo.split('.');
      const prefixStr = parts[0].toUpperCase();
      const posNum = parts[1] || '0';
      
      let globalId = prefixStr;
      const prefixParts = prefixStr.split('-');
      
      // Legacy upgrade logic
      if (prefixParts.length === 1 && configAisles) {
        const conf = configAisles.find(a => a.id.toUpperCase() === prefixStr);
        if (conf) {
          const floor = configFloors?.find(f => f.id === conf.floorId);
          if (floor) globalId = `${floor.almacenId}-${floor.id}-${prefixStr}`.toUpperCase();
        }
      } else if (prefixParts.length === 2 && configFloors) {
         const floorId = prefixParts[0];
         const aisleId = prefixParts[1];
         const floor = configFloors.find(f => f.id === floorId);
         if (floor) {
           globalId = `${floor.almacenId}-${floorId}-${aisleId}`.toUpperCase();
         }
      }
      
      return { pasillo: `${globalId}.${posNum}`, qty: parseInt(qty?.trim(), 10) || 0 };
    }).filter(l => l && l.pasillo && l.qty > 0);
  };

  const stringifyLocations = (locs) => {
    return locs.map(l => `${l.pasillo}:${l.qty}`).join(' | ');
  };

  const { floors, unallocatedProducts, allProductsWithStats, activeAlmacen } = useMemo(() => {
    const activeAlm = appConfig.almacenes?.find(a => a.id === selectedAlmacenId) || appConfig.almacenes?.[0];
    const stockCol = activeAlm?.stockColumn || 'WHSAL/Stock';
    const activeAlmacenPrefix = activeAlm ? `${activeAlm.id}-` : null;

    const unallocated = [];
    const parsedData = [];
    const allProducts = [];

    const grouped = {};
    const activeFloors = appConfig.floors?.filter(f => f.almacenId === activeAlm?.id) || [];
    
    activeFloors.forEach(floor => {
      grouped[floor.id] = { ...floor, aisles: {} };
    });

    appConfig.aisles?.forEach(a => {
      if (grouped[a.floorId]) {
         const globalId = `${activeAlm.id}-${a.floorId}-${a.id}`.toUpperCase();
         grouped[a.floorId].aisles[globalId] = { config: a, items: [] };
      }
    });

    inventory.forEach(item => {
      if (!item._uid) return;
      
      const name = item.name || item.producto || "Sin nombre";
      const stockStr = (item[stockCol] || "").toString().replace(/,/g, '');
      const totalStock = parseInt(stockStr, 10) || 0;
      
      const allLocs = parseLocations(item['Ubicaciones_App'], appConfig.floors, appConfig.aisles);
      const locsInActiveAlmacen = activeAlmacenPrefix ? allLocs.filter(l => l.pasillo.startsWith(activeAlmacenPrefix)) : [];
      
      const allocatedCount = locsInActiveAlmacen.reduce((sum, l) => sum + l.qty, 0);
      const unallocatedQty = Math.max(0, totalStock - allocatedCount);

      const prodData = {
        ...item,
        displayName: name,
        totalStock,
        allocatedCount,
        unallocatedQty,
        locs: allLocs
      };

      allProducts.push(prodData);

      if (unallocatedQty > 0) {
        unallocated.push(prodData);
      }

      locsInActiveAlmacen.forEach(loc => {
        const parts = loc.pasillo.split('.');
        const globalId = parts[0].toUpperCase();
        const posNum = parseInt(parts[1], 10) || 0;
        
        let floorId, localAisleId;
        
        const matchedAisle = appConfig.aisles?.find(a => {
          const expectedId = `${activeAlm?.id}-${a.floorId}-${a.id}`.toUpperCase();
          return expectedId === globalId;
        });

        if (matchedAisle) {
          floorId = matchedAisle.floorId;
          localAisleId = matchedAisle.id;
        } else if (activeAlm && globalId.startsWith(activeAlm.id.toUpperCase() + '-')) {
          const remainder = globalId.substring(activeAlm.id.length + 1);
          const dashIdx = remainder.indexOf('-');
          if (dashIdx !== -1) {
            floorId = remainder.substring(0, dashIdx);
            localAisleId = remainder.substring(dashIdx + 1);
          } else {
            floorId = 'UNALLOC';
            localAisleId = remainder;
          }
        } else {
          const idParts = globalId.split('-');
          if (idParts.length >= 3) {
            floorId = idParts[1];
            localAisleId = idParts.slice(2).join('-');
          } else {
            floorId = 'UNALLOC';
            localAisleId = globalId;
          }
        }

        const searchIndex = `${name} ${globalId} ${localAisleId}`.toLowerCase();

        parsedData.push({
          _uid: item._uid,
          displayName: name,
          qty: loc.qty,
          pasillo: loc.pasillo,
          globalId,
          localAisleId,
          floorId,
          posNum,
          searchIndex,
          draggableId: `${item._uid}-pasillo-${loc.pasillo}`
        });
      });
    });

    const filteredData = parsedData.filter(item =>
      item.searchIndex.includes(searchTerm.toLowerCase())
    );

    filteredData.forEach(item => {
      const { floorId, globalId } = item;
      if (floorId && grouped[floorId]) {
        if (!grouped[floorId].aisles[globalId]) {
           grouped[floorId].aisles[globalId] = { config: { id: item.localAisleId, floorId: floorId }, items: [] };
        }
        grouped[floorId].aisles[globalId].items.push(item);
      } else {
        if (!grouped['UNALLOC']) grouped['UNALLOC'] = { id: 'UNALLOC', name: 'Otros Pasillos (Sin Piso)', order: 999, aisles: {} };
        if (!grouped['UNALLOC'].aisles[globalId]) grouped['UNALLOC'].aisles[globalId] = { config: { id: item.localAisleId }, items: [] };
        grouped['UNALLOC'].aisles[globalId].items.push(item);
      }
    });

    Object.keys(grouped).forEach(fId => {
      const aislesObj = grouped[fId].aisles;
      Object.keys(aislesObj).forEach(aisleKey => {
        aislesObj[aisleKey].items.sort((a, b) => a.posNum - b.posNum);
      });
    });

    allProducts.sort((a, b) => {
      if (a.totalStock > 0 && b.totalStock === 0) return -1;
      if (a.totalStock === 0 && b.totalStock > 0) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    const filteredUnallocated = unallocated.filter(item =>
      item.displayName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    return { floors: grouped, unallocatedProducts: filteredUnallocated, allProductsWithStats: allProducts, activeAlmacen: activeAlm };
  }, [inventory, searchTerm, appConfig, selectedAlmacenId]);

  const sortedFloors = Object.keys(floors).sort((a, b) => floors[a].order - floors[b].order);

  const handleUpdateLocations = async (product, validActiveLocs, newStock = undefined) => {
    setLoadingAction(true);
    
    // Merge validActiveLocs with the locations of other almacenes that we are not editing
    const activeAlmacenPrefix = activeAlmacen ? `${activeAlmacen.id}-` : '';
    const otherLocs = product.locs ? product.locs.filter(l => !l.pasillo.startsWith(activeAlmacenPrefix)) : [];
    const mergedLocs = [...otherLocs, ...validActiveLocs];

    const newVal = stringifyLocations(mergedLocs);
    const body = { _uid: product._uid, Ubicaciones_App: newVal, stockColumn: activeAlmacen?.stockColumn || 'WHSAL/Stock' };
    if (newStock !== undefined) body.newStock = newStock;

    try {
      const res = await fetch('/api/inventory/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (data.success) {
        setInventory(prev => prev.map(p => p._uid === product._uid ? data.product : p));
        setSelectedProduct(null);
        setQuickAssignAisle(null);
        setSelectedForDeletion(prev => prev.filter(uid => uid !== product._uid));
      } else {
        alert("Error: " + data.error);
      }
    } catch (e) {
      alert("Error de conexión");
    }
    setLoadingAction(false);
  };

  const onDragEnd = async (result) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;

    const sourceAisle = source.droppableId;
    const destAisle = destination.droppableId;
    
    if (sourceAisle === 'sidebar-unallocated' && destAisle === 'sidebar-unallocated') return;
    
    const getItemsInAisle = (aisleId) => {
      const items = [];
      inventory.forEach(p => {
        const locs = parseLocations(p['Ubicaciones_App'], appConfig.floors, appConfig.aisles);
        locs.forEach(l => {
          if (l.pasillo.split('.')[0] === aisleId) {
            items.push({
              product: p,
              posNum: parseInt(l.pasillo.split('.')[1] || 0, 10),
              qty: l.qty,
              allLocs: locs
            });
          }
        });
      });
      return items.sort((a, b) => a.posNum - b.posNum);
    };

    const sourceItems = getItemsInAisle(sourceAisle);
    const destItems = sourceAisle === destAisle ? sourceItems : getItemsInAisle(destAisle);

    const updates = [];

    if (sourceAisle === destAisle) {
      if (source.index === destination.index) return;

      const [movedItem] = sourceItems.splice(source.index, 1);
      sourceItems.splice(destination.index, 0, movedItem);

      sourceItems.forEach((item, idx) => {
        const newPasillo = `${sourceAisle}.${idx + 1}`;
        const oldPasillo = `${sourceAisle}.${item.posNum}`;
        const specificLocIndex = item.allLocs.findIndex(l => l.pasillo === oldPasillo && l.qty === item.qty);
        
        if (specificLocIndex !== -1 && oldPasillo !== newPasillo) {
          item.allLocs[specificLocIndex].pasillo = newPasillo;
          updates.push({
            _uid: item.product._uid,
            Ubicaciones_App: stringifyLocations(item.allLocs)
          });
        }
      });
    } else if (sourceAisle === 'sidebar-unallocated') {
      const uid = draggableId.replace('sidebar-', '');
      const draggedProduct = unallocatedProducts.find(p => p._uid === uid);
      if (!draggedProduct) return;
      
      const destItems = getItemsInAisle(destAisle);
      const movedItem = {
        product: draggedProduct,
        qty: draggedProduct.unallocatedQty, // Asignar todo el stock restante al arrastrar
        posNum: -1,
        allLocs: draggedProduct.locs ? [...draggedProduct.locs] : []
      };
      
      destItems.splice(destination.index, 0, movedItem);

      destItems.forEach((item, idx) => {
        const newPasillo = `${destAisle}.${idx + 1}`;
        if (item === movedItem) {
          item.allLocs.push({ pasillo: newPasillo, qty: item.qty });
          updates.push({
            _uid: item.product._uid,
            Ubicaciones_App: stringifyLocations(item.allLocs),
            stockColumn: activeAlmacen?.stockColumn || 'WHSAL/Stock',
            // Increase stock if unallocatedQty is 0? unallocatedProducts only shows items with unallocatedQty > 0
          });
        } else {
          const itemOldPasillo = `${destAisle}.${item.posNum}`;
          const specLocIdx = item.allLocs.findIndex(l => l.pasillo === itemOldPasillo && l.qty === item.qty);
          if (specLocIdx !== -1 && itemOldPasillo !== newPasillo) {
            item.allLocs[specLocIdx].pasillo = newPasillo;
            updates.push({
              _uid: item.product._uid,
              Ubicaciones_App: stringifyLocations(item.allLocs)
            });
          }
        }
      });
    } else if (destAisle === 'sidebar-unallocated') {
      const [movedItem] = sourceItems.splice(source.index, 1);
      const oldPasillo = `${sourceAisle}.${movedItem.posNum}`;
      const locIndex = movedItem.allLocs.findIndex(l => l.pasillo === oldPasillo && l.qty === movedItem.qty);
      if (locIndex !== -1) {
        movedItem.allLocs.splice(locIndex, 1);
        updates.push({
          _uid: movedItem.product._uid,
          Ubicaciones_App: stringifyLocations(movedItem.allLocs)
        });
      }
      
      sourceItems.forEach((item, idx) => {
        const newPasillo = `${sourceAisle}.${idx + 1}`;
        const itemOldPasillo = `${sourceAisle}.${item.posNum}`;
        const specLocIdx = item.allLocs.findIndex(l => l.pasillo === itemOldPasillo && l.qty === item.qty);
        if (specLocIdx !== -1 && itemOldPasillo !== newPasillo) {
          item.allLocs[specLocIdx].pasillo = newPasillo;
          updates.push({
            _uid: item.product._uid,
            Ubicaciones_App: stringifyLocations(item.allLocs)
          });
        }
      });
    } else {
      const [movedItem] = sourceItems.splice(source.index, 1);
      const oldPasillo = `${sourceAisle}.${movedItem.posNum}`;
      const locIndex = movedItem.allLocs.findIndex(l => l.pasillo === oldPasillo && l.qty === movedItem.qty);
      if (locIndex !== -1) {
        movedItem.allLocs.splice(locIndex, 1);
      }
      
      sourceItems.forEach((item, idx) => {
        const newPasillo = `${sourceAisle}.${idx + 1}`;
        const itemOldPasillo = `${sourceAisle}.${item.posNum}`;
        const specLocIdx = item.allLocs.findIndex(l => l.pasillo === itemOldPasillo && l.qty === item.qty);
        if (specLocIdx !== -1 && itemOldPasillo !== newPasillo) {
          item.allLocs[specLocIdx].pasillo = newPasillo;
          updates.push({
            _uid: item.product._uid,
            Ubicaciones_App: stringifyLocations(item.allLocs)
          });
        }
      });

      movedItem.posNum = -1; 
      destItems.splice(destination.index, 0, movedItem);

      destItems.forEach((item, idx) => {
        const newPasillo = `${destAisle}.${idx + 1}`;
        if (item === movedItem) {
          item.allLocs.push({ pasillo: newPasillo, qty: item.qty });
          updates.push({
            _uid: item.product._uid,
            Ubicaciones_App: stringifyLocations(item.allLocs)
          });
        } else {
          const itemOldPasillo = `${destAisle}.${item.posNum}`;
          const specLocIdx = item.allLocs.findIndex(l => l.pasillo === itemOldPasillo && l.qty === item.qty);
          if (specLocIdx !== -1 && itemOldPasillo !== newPasillo) {
            item.allLocs[specLocIdx].pasillo = newPasillo;
            updates.push({
              _uid: item.product._uid,
              Ubicaciones_App: stringifyLocations(item.allLocs)
            });
          }
        }
      });
    }

    const dedupedUpdatesMap = {};
    updates.forEach(u => { dedupedUpdatesMap[u._uid] = u; });
    const finalUpdates = Object.values(dedupedUpdatesMap);

    if (finalUpdates.length > 0) {
      setLoadingAction(true);
      try {
        const res = await fetch('/api/inventory/update-bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ updates: finalUpdates })
        });
        const data = await res.json();
        if (data.success) {
          setInventory(prev => {
            const updatedUids = data.products.map(p => p._uid);
            return prev.map(p => updatedUids.includes(p._uid) ? data.products.find(up => up._uid === p._uid) : p);
          });
        } else {
          alert("Error: " + data.error);
        }
      } catch (e) {
        console.error(e);
        alert("Error guardando el nuevo orden.");
      }
      setLoadingAction(false);
    }
  };

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="min-h-screen bg-neutral-200 text-slate-800 font-sans flex flex-col md:flex-row relative">
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-slate-900/50 z-40 md:hidden" onClick={() => setIsSidebarOpen(false)}></div>
      )}
      <aside className={`fixed md:sticky top-0 left-0 w-80 md:w-80 bg-white border-r border-slate-300 flex flex-col h-screen z-50 shadow-lg transform transition-transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="p-4 bg-slate-900 text-white shadow-md">
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <Map className="w-6 h-6 text-emerald-400" />
              <h1 className="text-xl font-bold tracking-wide leading-none uppercase truncate" title={activeAlmacen?.name || 'ALMACÉN'}>
                {activeAlmacen?.name || 'ALMACÉN'}
              </h1>
            </div>
            <button onClick={() => setShowConfig(true)} className="text-slate-400 hover:text-white transition-colors">
              <Settings className="w-5 h-5"/>
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar producto..."
              className="w-full pl-9 pr-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        
        <div className="flex-grow overflow-y-auto p-4 bg-slate-50 hide-scrollbar relative">
          <div className="flex justify-between items-center mb-4 border-b pb-2 sticky top-0 bg-slate-50 z-20">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Sin Asignar o Parcial</h2>
            {selectedForDeletion.length > 0 && (
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    setConfirmDeleteDialog({
                      message: `¿Estás seguro que quieres eliminar las piezas sin asignar de los ${selectedForDeletion.length} artículos seleccionados? Se pondrá su stock sin asignar en cero.`,
                      onConfirm: () => {
                        setLoadingAction(true);
                      
                      const updates = selectedForDeletion.map(uid => {
                        const prod = unallocatedProducts.find(p => p._uid === uid);
                        if (!prod) return null;
                        const activeAlmacenPrefix = activeAlmacen ? `${activeAlmacen.id}-` : '';
                        const otherLocs = prod.locs ? prod.locs.filter(l => !l.pasillo.startsWith(activeAlmacenPrefix)) : [];
                        
                        return {
                          _uid: prod._uid,
                          Ubicaciones_App: stringifyLocations(prod.locs),
                          stockColumn: activeAlmacen?.stockColumn || 'WHSAL/Stock',
                          newStock: prod.allocatedCount // Reset totalStock to equal allocatedCount, effectively removing unallocated pieces
                        };
                      }).filter(Boolean);

                      fetch('/api/inventory/update-bulk', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ updates })
                      })
                      .then(res => res.json())
                      .then(data => {
                        if (data.success) {
                          setInventory(prev => {
                            const updatedUids = data.products.map(p => p._uid);
                            return prev.map(p => updatedUids.includes(p._uid) ? data.products.find(up => up._uid === p._uid) : p);
                          });
                          setSelectedForDeletion([]);
                        } else {
                          alert("Error: " + data.error);
                        }
                      })
                      .finally(() => setLoadingAction(false));
                      }
                    });
                  }}
                  className="text-[10px] bg-red-100 text-red-700 px-2 py-1 rounded font-bold hover:bg-red-200 transition-colors border border-red-200"
                >
                  Eliminar ({selectedForDeletion.length})
                </button>
                
                <button 
                  onClick={() => {
                    const itemsToTransfer = selectedForDeletion.map(uid => {
                      const prod = unallocatedProducts.find(p => p._uid === uid);
                      return { _uid: uid, qty: prod.unallocatedQty, name: prod.displayName };
                    });
                    setTransferDialog({ items: itemsToTransfer, sourceAlmacenId: selectedAlmacenId });
                  }}
                  className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-1 rounded font-bold hover:bg-emerald-200 transition-colors border border-emerald-200 flex items-center gap-1"
                >
                  <ArrowRightLeft className="w-3 h-3"/> Traspasar ({selectedForDeletion.length})
                </button>
              </div>
            )}
          </div>
          {!isDataLoaded ? (
            <div className="text-center py-10 text-slate-400 text-sm">Cargando...</div>
          ) : (
            <Droppable droppableId="sidebar-unallocated">
              {(provided, snapshot) => (
                <div 
                  className={`space-y-3 min-h-[150px] transition-colors rounded-lg p-1 ${snapshot.isDraggingOver ? 'bg-emerald-50/80 border-2 border-emerald-300 border-dashed' : ''}`}
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                >
                  {unallocatedProducts.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 text-sm flex flex-col items-center justify-center h-full pointer-events-none">
                      <span>Todo el stock está asignado 🎉</span>
                      <span className="text-xs mt-2 opacity-60">(Arrastra artículos aquí para desasignarlos)</span>
                    </div>
                  ) : (
                    unallocatedProducts.map((prod, idx) => (
                      <Draggable key={prod._uid} draggableId={`sidebar-${prod._uid}`} index={idx}>
                        {(provided, snapshot) => (
                          <div 
                            ref={provided.innerRef}
                            {...provided.draggableProps}
                            {...provided.dragHandleProps}
                            onClick={() => setSelectedProduct(prod)}
                            className={`group relative bg-white p-3 rounded border border-slate-200 shadow-sm cursor-pointer hover:border-emerald-400 hover:shadow transition-all ${snapshot.isDragging ? 'shadow-xl scale-105 border-emerald-500 z-50' : ''}`}
                          >
                            <input 
                              type="checkbox" 
                              className={`absolute top-2 right-2 w-4 h-4 cursor-pointer z-10 transition-opacity ${selectedForDeletion.includes(prod._uid) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                              checked={selectedForDeletion.includes(prod._uid)}
                              onChange={(e) => {
                                e.stopPropagation();
                                if (e.target.checked) setSelectedForDeletion([...selectedForDeletion, prod._uid]);
                                else setSelectedForDeletion(selectedForDeletion.filter(id => id !== prod._uid));
                              }}
                              onClick={e => e.stopPropagation()}
                            />
                            <h3 className="text-sm font-bold text-slate-800 leading-tight mb-1 pr-6">{prod.displayName}</h3>
                            <div className="flex justify-between items-center mt-2">
                              <span className="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold">
                                Faltan: {prod.unallocatedQty}
                              </span>
                              <div className="flex items-center gap-2">
                                <button 
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setTransferDialog({ 
                                      items: [{ _uid: prod._uid, qty: prod.unallocatedQty, name: prod.displayName }], 
                                      sourceAlmacenId: selectedAlmacenId 
                                    });
                                  }}
                                  className="text-[10px] bg-emerald-50 hover:bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold transition-colors border border-emerald-200"
                                  title="Transferir a otro almacén"
                                >
                                  <ArrowRightLeft className="w-3 h-3"/>
                                </button>
                                <span className="text-[10px] text-slate-500">Total: {prod.totalStock}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))
                  )}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          )}
        </div>
      </aside>

      <main className="flex-grow p-4 md:p-8 overflow-y-auto h-screen hide-scrollbar relative">
        <div className="md:hidden flex items-center gap-3 mb-4 bg-white p-3 rounded shadow-sm border border-slate-200">
          <button onClick={() => setIsSidebarOpen(true)} className="text-emerald-600 bg-emerald-50 p-2 rounded-md hover:bg-emerald-100 flex items-center justify-center">
            <Layers className="w-5 h-5"/>
          </button>
          <h1 className="font-black text-slate-800">Menú Almacén</h1>
        </div>
        {!isDataLoaded ? (
          <div className="flex justify-center items-center py-20">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600"></div>
          </div>
        ) : (

            <div className="space-y-12 max-w-[1400px] mx-auto pb-24">
              {sortedFloors.map(floorId => {
                const floorData = floors[floorId];
                if (!floorData) return null;
                
                const sortedAisles = Object.keys(floorData.aisles).sort((a, b) => {
                  const localA = floorData.aisles[a].config.id;
                  const localB = floorData.aisles[b].config.id;
                  const numA = parseInt(localA.replace(/[^0-9]/g, ''), 10) || 0;
                  const numB = parseInt(localB.replace(/[^0-9]/g, ''), 10) || 0;
                  if (numA === numB) return localA.localeCompare(localB);
                  return numA - numB;
                });

                if (sortedAisles.length === 0) return null;

                return (
                  <section key={floorId} className="bg-slate-100 p-6 rounded-xl border border-slate-300 shadow-inner">
                    <div className="flex items-center gap-3 mb-6">
                      <Layers className="w-6 h-6 text-slate-700" />
                      <h2 className="text-2xl font-black text-slate-800 uppercase tracking-widest">{floorData.name}</h2>
                    </div>

                    <div className="flex overflow-x-auto pb-6 gap-6 items-start hide-scrollbar">
                      {sortedAisles.map(globalId => {
                        const aisleObj = floorData.aisles[globalId];
                        const items = aisleObj.items;
                        const localId = aisleObj.config.id;
                        
                        return (
                          <div key={globalId} className="flex-shrink-0 w-72 bg-white rounded-lg shadow-md border-t-8 border-t-slate-800 flex flex-col max-h-[70vh]">
                            <div className="p-3 border-b border-slate-100 bg-slate-50 flex justify-between items-center sticky top-0 z-10">
                              <span className="font-bold text-slate-700">Pasillo {localId}</span>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono bg-slate-200 text-slate-600 px-2 py-1 rounded-full">
                                  {items.length}
                                </span>
                                <button onClick={() => setQuickAssignAisle(globalId)} className="text-emerald-600 hover:bg-emerald-100 p-1 rounded transition-colors">
                                  <Plus className="w-4 h-4"/>
                                </button>
                              </div>
                            </div>

                            <Droppable droppableId={globalId}>
                              {(provided, snapshot) => (
                                <div 
                                  {...provided.droppableProps} 
                                  ref={provided.innerRef}
                                  className={`p-3 overflow-y-auto flex-grow space-y-3 bg-slate-50/50 relative min-h-[150px] transition-colors ${snapshot.isDraggingOver ? 'bg-emerald-50' : ''}`}
                                >
                                  {items.length > 0 && <div className="absolute left-1/2 top-0 bottom-0 w-8 -ml-4 bg-slate-200/50 border-x border-slate-200 pointer-events-none z-0"></div>}
                                  
                                  {items.length === 0 ? (
                                    <div className="text-center py-10 text-slate-400 text-sm italic z-10 relative pointer-events-none">Pasillo vacío</div>
                                  ) : (
                                    items.map((item, idx) => (
                                      <Draggable key={item.draggableId} draggableId={item.draggableId} index={idx}>
                                        {(provided, snapshot) => (
                                          <div 
                                            ref={provided.innerRef}
                                            {...provided.draggableProps}
                                            {...provided.dragHandleProps}
                                            className={`relative z-10 bg-white border rounded-md p-3 shadow-sm transition-all cursor-grab active:cursor-grabbing ${snapshot.isDragging ? 'border-emerald-500 shadow-lg scale-105' : 'border-slate-200 hover:border-emerald-300'}`}
                                            style={{ ...provided.draggableProps.style }}
                                          >
                                            <div className="flex justify-between items-start mb-1">
                                              <span className="bg-slate-800 text-white text-[10px] font-mono px-1.5 py-0.5 rounded flex items-center gap-1">
                                                <GripVertical className="w-3 h-3 opacity-50"/> Pos. {item.posNum}
                                              </span>
                                            </div>
                                            <h3 className="text-sm font-bold text-slate-800 leading-tight mb-2" onClick={() => setSelectedProduct(allProductsWithStats.find(i => i._uid === item._uid))}>{item.displayName}</h3>
                                            <div className="flex justify-between items-end mt-2 pt-2 border-t border-slate-50">
                                              <span className="text-[10px] text-slate-400 uppercase font-bold">QTY</span>
                                              <span className="text-base font-black leading-none text-emerald-600">{item.qty}</span>
                                            </div>
                                          </div>
                                        )}
                                      </Draggable>
                                    ))
                                  )}
                                  {provided.placeholder}
                                </div>
                              )}
                            </Droppable>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                );
              })}
            </div>

        )}
      </main>

      {/* Almacen Selector FAB */}
      {isDataLoaded && appConfig.almacenes?.length > 0 && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end">
          {isAlmacenSelectorOpen && (
            <div className="mb-3 bg-white rounded-lg shadow-xl border border-slate-200 overflow-hidden w-56 flex flex-col animate-in slide-in-from-bottom-5">
              <div className="bg-slate-800 text-white px-4 py-2 text-xs font-bold uppercase tracking-wider">
                Seleccionar Almacén
              </div>
              {appConfig.almacenes.map(alm => (
                <button
                  key={alm.id}
                  onClick={() => {
                    setSelectedAlmacenId(alm.id);
                    setIsAlmacenSelectorOpen(false);
                  }}
                  className={`px-4 py-3 text-left font-bold transition-colors ${alm.id === selectedAlmacenId ? 'bg-emerald-50 text-emerald-700 border-l-4 border-emerald-500' : 'text-slate-700 hover:bg-slate-50 border-l-4 border-transparent'}`}
                >
                  {alm.name}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setIsAlmacenSelectorOpen(!isAlmacenSelectorOpen)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white rounded-full shadow-lg flex items-center justify-center gap-2 px-6 py-3 transition-all hover:scale-105 hover:shadow-xl"
          >
            <Building2 className="w-5 h-5"/>
            <span className="font-bold max-w-[150px] truncate">{activeAlmacen?.name || 'Almacenes'}</span>
            <ChevronDown className={`w-4 h-4 transition-transform ${isAlmacenSelectorOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      )}

      {selectedProduct && (
        <AssignmentModal 
          product={selectedProduct} 
          activeAlmacenId={selectedAlmacenId}
          appConfig={appConfig}
          onClose={() => setSelectedProduct(null)} 
          onSave={handleUpdateLocations} 
          onTransfer={(prod) => {
            setSelectedProduct(null);
            setTransferDialog({ 
              items: [{ _uid: prod._uid, qty: prod.unallocatedQty, name: prod.displayName }], 
              sourceAlmacenId: selectedAlmacenId 
            });
          }}
          loading={loadingAction}
        />
      )}

      {/* Transfer Modal */}
      {transferDialog && (
        <TransferModal
          transferData={transferDialog}
          appConfig={appConfig}
          onClose={() => setTransferDialog(null)}
          onConfirm={(targetAlmacenId, items) => {
            setLoadingAction(true);
            const sourceAlm = appConfig.almacenes.find(a => a.id === transferDialog.sourceAlmacenId);
            const targetAlm = appConfig.almacenes.find(a => a.id === targetAlmacenId);
            
            fetch('/api/inventory/transfer', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                transfers: items,
                sourceColumn: sourceAlm.stockColumn,
                targetColumn: targetAlm.stockColumn
              })
            })
            .then(res => res.json())
            .then(data => {
              if (data.success) {
                setInventory(prev => {
                  const updatedUids = data.products.map(p => p._uid);
                  return prev.map(p => updatedUids.includes(p._uid) ? data.products.find(up => up._uid === p._uid) : p);
                });
                setTransferDialog(null);
                setSelectedForDeletion([]); // Clear bulk selection if any
              } else {
                alert("Error transfiriendo: " + data.error);
              }
            })
            .catch(err => alert("Error de conexión."))
            .finally(() => setLoadingAction(false));
          }}
          loading={loadingAction}
        />
      )}

      {showConfig && (
        <ConfigModal 
          config={appConfig} 
          csvColumns={csvColumns}
          onClose={() => setShowConfig(false)} 
          onSave={async (newConfig) => {
            const res = await fetch('/api/config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(newConfig)
            });
            if(res.ok) {
              setAppConfig(newConfig);
              if(!newConfig.almacenes.find(a => a.id === selectedAlmacenId) && newConfig.almacenes.length > 0) {
                setSelectedAlmacenId(newConfig.almacenes[0].id);
              }
              setShowConfig(false);
            }
          }}
        />
      )}

      {confirmDeleteDialog && (
        <div className="fixed inset-0 bg-slate-900/60 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden animate-in">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
               <AlertTriangle className="w-5 h-5 text-red-500" />
               <h4 className="font-bold text-slate-800">Confirmar Eliminación</h4>
            </div>
            <div className="p-5">
              <p className="text-slate-600 text-sm">{confirmDeleteDialog.message}</p>
            </div>
            <div className="p-4 bg-slate-50 border-t flex justify-end gap-3">
              <button onClick={() => setConfirmDeleteDialog(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded transition-colors">Cancelar</button>
              <button onClick={() => { confirmDeleteDialog.onConfirm(); setConfirmDeleteDialog(null); }} className="px-4 py-2 text-sm font-bold text-white rounded bg-red-600 hover:bg-red-700 shadow-sm transition-colors">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {quickAssignAisle && (
        <QuickAssignModal 
          aisle={quickAssignAisle}
          products={allProductsWithStats}
          onClose={() => setQuickAssignAisle(null)}
          onSave={handleUpdateLocations}
          inventory={inventory}
        />
      )}

      <style dangerouslySetInnerHTML={{
        __html: `
        .hide-scrollbar::-webkit-scrollbar { height: 8px; width: 6px; }
        .hide-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .hide-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 4px; }
        .hide-scrollbar::-webkit-scrollbar-thumb:hover { background: #94a3b8; }
        @keyframes slideIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .animate-in { animation: slideIn 0.2s ease-out forwards; }
      `}} />
      </div>
    </DragDropContext>
  );
}

// Quick Assignment Modal
function QuickAssignModal({ aisle, products, onClose, onSave, inventory }) {
  const [search, setSearch] = useState("");
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [qty, setQty] = useState(1);
  const [showConfirmNewStock, setShowConfirmNewStock] = useState(false);

  const filtered = search.trim() ? products.filter(p => p.displayName.toLowerCase().includes(search.trim().toLowerCase())) : products;

  const handleAssign = () => {
    if (!selectedProduct) return;
    const { unallocatedQty, totalStock } = selectedProduct;
    
    if (qty > unallocatedQty) {
      setShowConfirmNewStock(true);
      return;
    }
    
    executeSave();
  };

  const executeSave = (isNewInventory = false) => {
    // Only pass back the NEW location snippet.
    // The main handleUpdateLocations will merge this.
    // Actually, QuickAssignModal passes ALL valid locs for active almacen?
    // Let's pass the active locs + new loc
    
    const activeAlmacenPrefix = aisle.split('-')[0] + '-';
    let activeLocs = selectedProduct.locs ? selectedProduct.locs.filter(l => l.pasillo.startsWith(activeAlmacenPrefix)) : [];
    
    const existingItemsInAisle = [];
    products.forEach(item => {
      if (item.locs) {
        item.locs.forEach(l => {
          if(l.pasillo.split('.')[0] === aisle) {
            existingItemsInAisle.push(parseInt(l.pasillo.split('.')[1] || 0, 10));
          }
        });
      }
    });

    const nextPos = existingItemsInAisle.length > 0 ? Math.max(...existingItemsInAisle) + 1 : 1;
    activeLocs.push({ pasillo: `${aisle}.${nextPos}`, qty });

    let newStock = undefined;
    if (isNewInventory) {
      newStock = selectedProduct.totalStock + (qty - selectedProduct.unallocatedQty);
    }
    
    onSave(selectedProduct, activeLocs, newStock);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 bg-emerald-700 text-white flex justify-between items-center">
          <h3 className="font-bold">Asignación Rápida a Pasillo {aisle}</h3>
          <button onClick={onClose} className="text-emerald-200 hover:text-white"><X className="w-5 h-5"/></button>
        </div>
        
        {!showConfirmNewStock ? (
          <div className="p-6 overflow-y-auto flex-grow flex flex-col">
            <div className="mb-4">
              <input 
                type="text" 
                placeholder="Buscar artículo..." 
                className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-emerald-500 outline-none"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if(e.key === 'Enter') e.target.blur(); }}
              />
            </div>
            
            <div className="flex-grow overflow-y-auto border border-slate-200 rounded-lg mb-4 max-h-[40vh] divide-y divide-slate-100">
              {filtered.map(p => (
                <div 
                  key={p._uid} 
                  onClick={() => setSelectedProduct(p)}
                  className={`p-3 cursor-pointer hover:bg-slate-50 flex justify-between items-center transition-colors ${selectedProduct?._uid === p._uid ? 'bg-emerald-50 border-l-4 border-emerald-500' : 'border-l-4 border-transparent'}`}
                >
                  <div className="flex-grow pr-4">
                    <p className="font-bold text-sm text-slate-800">{p.displayName}</p>
                    {p.totalStock === 0 && <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold">Agotado</span>}
                  </div>
                  <div className="flex gap-2 text-right flex-shrink-0">
                    <div className="bg-slate-100 px-2 py-1 rounded text-center">
                      <p className="text-[9px] font-bold text-slate-500 uppercase">En Pasillos</p>
                      <p className="font-black text-slate-700 text-sm">{p.allocatedCount}</p>
                    </div>
                    <div className={`${p.unallocatedQty > 0 ? 'bg-emerald-100' : 'bg-slate-100'} px-2 py-1 rounded text-center min-w-[60px]`}>
                      <p className={`text-[9px] font-bold uppercase ${p.unallocatedQty > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>Sin Asignar</p>
                      <p className={`font-black text-sm ${p.unallocatedQty > 0 ? 'text-emerald-700' : 'text-slate-700'}`}>{p.unallocatedQty}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {selectedProduct && (
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800">{selectedProduct.displayName}</p>
                  <p className="text-xs text-slate-500">Stock Total: {selectedProduct.totalStock} | Sin Asignar: {selectedProduct.unallocatedQty}</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold text-slate-600">Cantidad:</label>
                  <input 
                    type="number" 
                    min="1" 
                    value={qty} 
                    onChange={e => setQty(parseInt(e.target.value) || 1)} 
                    className="w-20 p-2 border border-slate-300 rounded text-center font-bold"
                  />
                  <button onClick={handleAssign} className="bg-emerald-600 text-white px-4 py-2 rounded font-bold hover:bg-emerald-700 transition-colors">
                    Añadir
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="p-6">
            <div className="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6 rounded">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0"/>
                <div>
                  <h4 className="font-bold text-amber-900 mb-1">Stock Insuficiente</h4>
                  <p className="text-sm text-amber-800">
                    Estás intentando asignar <strong>{qty}</strong> unidades, pero solo hay <strong>{selectedProduct.unallocatedQty}</strong> sin asignar en el sistema (Total: {selectedProduct.totalStock}).
                  </p>
                </div>
              </div>
            </div>

            <p className="font-bold text-slate-700 mb-4">¿Qué deseas hacer?</p>
            
            <div className="space-y-3">
              <button onClick={() => executeSave(true)} className="w-full text-left p-4 border border-emerald-200 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors">
                <p className="font-bold text-emerald-800">Añadir inventario no contabilizado</p>
                <p className="text-xs text-emerald-600 mt-1">Se agregará al pasillo {aisle} y el "Stock Total" del sistema aumentará a {selectedProduct.totalStock + (qty - selectedProduct.unallocatedQty)}.</p>
              </button>

              <button onClick={() => { setShowConfirmNewStock(false); }} className="w-full text-left p-4 border border-slate-200 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors">
                <p className="font-bold text-slate-800">Cancelar y reubicar manualmente</p>
                <p className="text-xs text-slate-500 mt-1">Regresar para arrastrar el artículo desde su pasillo actual hacia aquí.</p>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Configuration Modal
function ConfigModal({ config, csvColumns, onClose, onSave }) {
  const [localConfig, setLocalConfig] = useState(JSON.parse(JSON.stringify(config)));
  const [dialog, setDialog] = useState(null);
  const [formInput1, setFormInput1] = useState("");
  const [formInput2, setFormInput2] = useState("");
  const [formInput3, setFormInput3] = useState("");

  const handleAddAlmacen = () => {
    setFormInput1(""); setFormInput2(""); setFormInput3(csvColumns[0] || "");
    setDialog({ type: 'addAlmacen' });
  };

  const handleAddFloor = (almacenId) => {
    setFormInput1(""); setFormInput2("");
    setDialog({ type: 'addFloor', data: almacenId });
  };

  const handleAddAisle = (floorId) => {
    setFormInput1("");
    setDialog({ type: 'addAisle', data: floorId });
  };

  const removeAlmacen = (id) => setDialog({ type: 'confirmRemoveAlmacen', data: id });
  const removeFloor = (id) => setDialog({ type: 'confirmRemoveFloor', data: id });
  const removeAisle = (id) => setDialog({ type: 'confirmRemoveAisle', data: id });

  const executeDialog = () => {
    if (dialog.type === 'addAlmacen') {
      if(!formInput1 || !formInput2) return;
      setLocalConfig(prev => ({
        ...prev,
        almacenes: [...(prev.almacenes||[]), { id: formInput1.toUpperCase(), name: formInput2, stockColumn: formInput3 }]
      }));
    } else if (dialog.type === 'addFloor') {
      if(!formInput1 || !formInput2) return;
      setLocalConfig(prev => ({
        ...prev,
        floors: [...(prev.floors||[]), { id: formInput1.toUpperCase(), name: formInput2, almacenId: dialog.data, order: (prev.floors||[]).length }]
      }));
    } else if (dialog.type === 'addAisle') {
      if(!formInput1) return;
      setLocalConfig(prev => ({
        ...prev,
        aisles: [...(prev.aisles||[]), { id: formInput1.toUpperCase(), floorId: dialog.data }]
      }));
    } else if (dialog.type === 'confirmRemoveAisle') {
      setLocalConfig(prev => ({
        ...prev,
        aisles: prev.aisles.filter(a => a.id !== dialog.data)
      }));
    } else if (dialog.type === 'confirmRemoveFloor') {
      setLocalConfig(prev => ({
        ...prev,
        floors: prev.floors.filter(f => f.id !== dialog.data),
        aisles: prev.aisles.filter(a => a.floorId !== dialog.data)
      }));
    } else if (dialog.type === 'confirmRemoveAlmacen') {
      setLocalConfig(prev => {
        const remainingFloors = prev.floors.filter(f => f.almacenId !== dialog.data);
        const remainingFloorIds = remainingFloors.map(f => f.id);
        return {
          ...prev,
          almacenes: prev.almacenes.filter(a => a.id !== dialog.data),
          floors: remainingFloors,
          aisles: prev.aisles.filter(a => remainingFloorIds.includes(a.floorId))
        };
      });
    }
    setDialog(null);
  };

  const updateAlmacenColumn = (almacenId, newCol) => {
    setLocalConfig(prev => ({
      ...prev,
      almacenes: prev.almacenes.map(a => a.id === almacenId ? { ...a, stockColumn: newCol } : a)
    }));
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 bg-slate-800 text-white flex justify-between items-center">
          <h3 className="font-bold">Configuración de Almacén</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5"/></button>
        </div>
        
        <div className="p-6 overflow-y-auto space-y-6">
          <div className="flex justify-between items-center border-b pb-2">
            <h4 className="font-bold text-lg text-slate-800">Almacenes</h4>
            <button onClick={handleAddAlmacen} className="bg-emerald-100 hover:bg-emerald-200 text-emerald-800 text-sm px-3 py-1.5 rounded font-bold transition-colors">
              + Agregar Almacén
            </button>
          </div>

          <div className="space-y-6">
            {(localConfig.almacenes||[]).map(alm => (
              <div key={alm.id} className="bg-slate-100 border border-slate-300 rounded-lg p-4">
                <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-200">
                  <div>
                    <h5 className="font-black text-slate-800 text-lg">
                      {alm.name} <span className="text-xs font-mono text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded ml-2">ID: {alm.id}</span>
                    </h5>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-600">Columna de Stock CSV:</span>
                      <select 
                        value={alm.stockColumn || ''} 
                        onChange={(e) => updateAlmacenColumn(alm.id, e.target.value)}
                        className="text-xs border-slate-300 rounded p-1"
                      >
                        {csvColumns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleAddFloor(alm.id)} className="text-emerald-700 bg-emerald-100 hover:bg-emerald-200 text-xs px-2 py-1 rounded font-bold transition-colors">
                      + Agregar Piso
                    </button>
                    <button onClick={() => removeAlmacen(alm.id)} className="text-red-500 hover:bg-red-50 p-1 rounded transition-colors"><X className="w-5 h-5"/></button>
                  </div>
                </div>
                
                <div className="space-y-3 pl-4 border-l-2 border-slate-200">
                  {(localConfig.floors||[]).filter(f => f.almacenId === alm.id).sort((a,b)=>a.order-b.order).map(floor => (
                    <div key={floor.id} className="bg-white border border-slate-200 rounded p-3 shadow-sm">
                      <div className="flex justify-between items-center mb-2">
                        <h6 className="font-bold text-slate-700 text-sm">{floor.name} <span className="text-xs font-mono text-slate-400">({floor.id})</span></h6>
                        <div className="flex gap-2">
                          <button onClick={() => handleAddAisle(floor.id)} className="text-blue-600 hover:bg-blue-50 text-[10px] px-2 py-1 rounded font-bold border border-blue-200 transition-colors">
                            + Pasillo
                          </button>
                          <button onClick={() => removeFloor(floor.id)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4"/></button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(localConfig.aisles||[]).filter(a => a.floorId === floor.id).map(a => (
                          <div key={a.id} className="bg-slate-50 border border-slate-200 px-2 py-1 rounded flex items-center gap-1">
                            <span className="font-bold text-xs text-slate-600">Pasillo {a.id}</span>
                            <button onClick={() => removeAisle(a.id)} className="text-red-400 hover:text-red-600 ml-1"><X className="w-3 h-3"/></button>
                          </div>
                        ))}
                        {(localConfig.aisles||[]).filter(a => a.floorId === floor.id).length === 0 && (
                          <span className="text-xs text-slate-400 italic">Sin pasillos.</span>
                        )}
                      </div>
                    </div>
                  ))}
                  {(localConfig.floors||[]).filter(f => f.almacenId === alm.id).length === 0 && (
                    <p className="text-sm text-slate-400 italic">No hay pisos en este almacén.</p>
                  )}
                </div>
              </div>
            ))}
            {(localConfig.almacenes||[]).length === 0 && (
              <p className="text-center text-slate-500 py-4">No hay almacenes configurados.</p>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded transition-colors">Cancelar</button>
          <button onClick={() => onSave(localConfig)} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded shadow-sm flex items-center gap-2 transition-all">
            <Save className="w-4 h-4"/> Guardar Configuración
          </button>
        </div>
      </div>

      {dialog && (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 bg-slate-50">
              <h4 className="font-bold text-slate-800">
                {dialog.type === 'addAlmacen' ? 'Nuevo Almacén' : 
                 dialog.type === 'addFloor' ? 'Nuevo Piso' : 
                 dialog.type === 'addAisle' ? 'Nuevo Pasillo' : 
                 'Confirmar Eliminación'}
              </h4>
            </div>
            <div className="p-5">
              {dialog.type === 'addAlmacen' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-600 mb-1 block">ID (ej. SUR, NORTE)</label>
                    <input type="text" className="w-full border border-slate-300 p-2 rounded focus:ring-emerald-500 focus:outline-none focus:ring-2 uppercase" value={formInput1} onChange={e => setFormInput1(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 mb-1 block">Nombre (ej. Sucursal Sur)</label>
                    <input type="text" className="w-full border border-slate-300 p-2 rounded focus:ring-emerald-500 focus:outline-none focus:ring-2" value={formInput2} onChange={e => setFormInput2(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 mb-1 block">Columna de Stock en CSV</label>
                    <select className="w-full border border-slate-300 p-2 rounded" value={formInput3} onChange={e => setFormInput3(e.target.value)}>
                      {csvColumns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {dialog.type === 'addFloor' && (
                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-slate-600 mb-1 block">ID (ej. PB, P1, AP)</label>
                    <input type="text" className="w-full border border-slate-300 p-2 rounded focus:ring-emerald-500 focus:outline-none focus:ring-2 uppercase" value={formInput1} onChange={e => setFormInput1(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-slate-600 mb-1 block">Nombre (ej. Planta Baja)</label>
                    <input type="text" className="w-full border border-slate-300 p-2 rounded focus:ring-emerald-500 focus:outline-none focus:ring-2" value={formInput2} onChange={e => setFormInput2(e.target.value)} />
                  </div>
                </div>
              )}
              {dialog.type === 'addAisle' && (
                <div>
                  <label className="text-xs font-bold text-slate-600 mb-1 block">ID del Pasillo (ej. 1, 15, A)</label>
                  <input type="text" className="w-full border border-slate-300 p-2 rounded focus:ring-emerald-500 focus:outline-none focus:ring-2 uppercase" value={formInput1} onChange={e => setFormInput1(e.target.value)} />
                </div>
              )}
              {dialog.type === 'confirmRemoveAisle' && (
                <p className="text-slate-600">¿Estás seguro de eliminar el pasillo <strong>{dialog.data}</strong>?</p>
              )}
              {dialog.type === 'confirmRemoveFloor' && (
                <p className="text-red-600 font-medium">¿Seguro que deseas eliminar el piso <strong>{dialog.data}</strong> y TODOS sus pasillos?</p>
              )}
              {dialog.type === 'confirmRemoveAlmacen' && (
                <p className="text-red-600 font-bold">¿Seguro de eliminar el almacén completo <strong>{dialog.data}</strong>? Se borrarán todos los pisos y pasillos de este almacén.</p>
              )}
            </div>
            <div className="p-4 bg-slate-50 border-t flex justify-end gap-3">
              <button onClick={() => setDialog(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded">Cancelar</button>
              <button onClick={executeDialog} className={`px-4 py-2 text-sm font-bold text-white rounded ${dialog.type.includes('Remove') ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
                {dialog.type.includes('Remove') ? 'Eliminar' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// New Transfer Modal Component
function TransferModal({ transferData, appConfig, onClose, onConfirm, loading }) {
  const [targetAlmacenId, setTargetAlmacenId] = useState('');
  
  // We allow adjusting quantities per item if multiple, but default to max unallocated
  const [items, setItems] = useState(transferData.items.map(item => ({...item})));

  const sourceAlmacen = appConfig.almacenes?.find(a => a.id === transferData.sourceAlmacenId);
  const targetOptions = appConfig.almacenes?.filter(a => a.id !== transferData.sourceAlmacenId) || [];

  const handleQtyChange = (index, val) => {
    const maxQty = transferData.items[index].qty;
    let newQty = parseInt(val, 10);
    if (isNaN(newQty) || newQty < 1) newQty = 1;
    if (newQty > maxQty) newQty = maxQty;
    
    setItems(prev => {
      const n = [...prev];
      n[index].qty = newQty;
      return n;
    });
  };

  const handleConfirm = () => {
    if (!targetAlmacenId) return alert("Selecciona un almacén destino");
    onConfirm(targetAlmacenId, items);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[80] flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg overflow-hidden animate-in">
        <div className="p-4 border-b border-slate-200 bg-slate-800 text-white flex items-center gap-2">
           <ArrowRightLeft className="w-5 h-5 text-emerald-400" />
           <h4 className="font-bold">Traspaso de Mercancía</h4>
        </div>
        <div className="p-6">
          <div className="mb-6">
            <p className="text-sm text-slate-500 font-bold uppercase mb-1">Origen</p>
            <p className="text-lg font-black text-slate-800">{sourceAlmacen?.name}</p>
          </div>
          
          <div className="mb-6">
            <p className="text-sm text-slate-500 font-bold uppercase mb-2">Destino</p>
            <select 
              className="w-full border border-slate-300 p-3 rounded-lg focus:ring-emerald-500 focus:border-emerald-500 font-bold text-slate-700"
              value={targetAlmacenId}
              onChange={e => setTargetAlmacenId(e.target.value)}
            >
              <option value="" disabled>Selecciona un almacén...</option>
              {targetOptions.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {targetOptions.length === 0 && <p className="text-xs text-red-500 mt-1">No hay otros almacenes configurados.</p>}
          </div>

          <div className="mb-2">
            <p className="text-sm text-slate-500 font-bold uppercase">Artículos a transferir ({items.length})</p>
            <p className="text-xs text-amber-600 font-bold italic mb-3 bg-amber-50 p-2 rounded">Solo se puede transferir el stock que está "Sin Asignar".</p>
            <div className="max-h-48 overflow-y-auto space-y-2 pr-2 hide-scrollbar">
              {items.map((item, i) => (
                <div key={item._uid} className="flex justify-between items-center bg-slate-50 p-3 rounded border border-slate-200">
                  <div className="flex-1 pr-4">
                    <p className="text-sm font-bold text-slate-800 leading-tight">{item.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-400">Qty:</span>
                    <input 
                      type="number" 
                      min="1" 
                      max={transferData.items[i].qty}
                      value={item.qty}
                      onChange={e => handleQtyChange(i, e.target.value)}
                      className="w-16 p-1 border border-slate-300 rounded text-center font-bold text-emerald-700"
                    />
                    <span className="text-xs text-slate-400 block w-10 text-right">/ {transferData.items[i].qty}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="p-4 bg-slate-50 border-t flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded transition-colors">Cancelar</button>
          <button 
            onClick={handleConfirm} 
            disabled={loading || !targetAlmacenId || items.length === 0} 
            className="px-6 py-2 text-sm font-bold text-white rounded bg-emerald-600 hover:bg-emerald-700 shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/> : <ArrowRightLeft className="w-4 h-4"/>}
            Confirmar Traspaso
          </button>
        </div>
      </div>
    </div>
  );
}

// Existing Assignment Modal (Adapted with Dropdowns)
function AssignmentModal({ product, activeAlmacenId, appConfig, onClose, onSave, onTransfer, loading }) {
  const totalStock = product.totalStock; 
  
  const activeAlmacenPrefix = activeAlmacenId ? `${activeAlmacenId}-` : '';
  const activeFloors = appConfig.floors?.filter(f => f.almacenId === activeAlmacenId) || [];
  const activeAisles = appConfig.aisles || [];

  const initialLocs = product.locs ? product.locs.filter(l => l.pasillo.startsWith(activeAlmacenPrefix)).map(l => {
    const parts = l.pasillo.split('.');
    const globalId = parts[0];
    const posNum = parts[1] || '1';
    const idParts = globalId.split('-');
    
    let floorId = '';
    let aisleId = '';
    if (idParts.length >= 3) {
      floorId = idParts[1];
      aisleId = idParts.slice(2).join('-');
    } else {
      floorId = 'OTHER';
      aisleId = l.pasillo.replace(activeAlmacenPrefix, '');
    }
    return { floorId, aisleId, posNum, qty: l.qty, rawPasillo: l.pasillo };
  }) : [];

  const [locs, setLocs] = useState(initialLocs.length > 0 ? initialLocs : [{ floorId: activeFloors[0]?.id || '', aisleId: '', posNum: '1', qty: totalStock, rawPasillo: '' }]);

  const allocated = locs.reduce((s, l) => s + (parseInt(l.qty, 10)||0), 0);
  const remaining = totalStock - allocated;
  const originalAllocated = product.allocatedCount || 0;
  const originalUnallocated = Math.max(0, totalStock - originalAllocated);
  const [confirmDialog, setConfirmDialog] = useState(null);

  const addRow = () => setLocs([...locs, { floorId: activeFloors[0]?.id || '', aisleId: '', posNum: '1', qty: remaining > 0 ? remaining : 1, rawPasillo: '' }]);
  const updateRow = (index, updates) => {
    setLocs(prev => {
      const newLocs = [...prev];
      newLocs[index] = { ...newLocs[index], ...updates };
      return newLocs;
    });
  };
  const removeRow = (index) => setLocs(locs.filter((_, i) => i !== index));

  const handleSave = () => {
    const validLocs = locs.filter(l => (l.floorId && l.aisleId && l.qty > 0) || (l.floorId === 'OTHER' && l.rawPasillo && l.qty > 0));
    const newAllocated = validLocs.reduce((s, l) => s + parseInt(l.qty, 10), 0);
    const maxAllowed = Math.max(totalStock, product.allocatedCount || 0);
    if (newAllocated > maxAllowed) {
      alert("No puedes asignar más piezas (" + newAllocated + ") de las que existen en el stock para este almacén (" + totalStock + "). Usa asignación rápida para añadir stock nuevo.");
      return;
    }
    
    const prefixedLocs = validLocs.map(l => {
      if (l.floorId === 'OTHER') {
         return { pasillo: l.rawPasillo, qty: l.qty };
      } else {
         return { pasillo: `${activeAlmacenId}-${l.floorId}-${l.aisleId}.${l.posNum}`, qty: l.qty };
      }
    });

    onSave(product, prefixedLocs);
  };

  const name = product.name || product.producto || "Sin nombre";

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-4 bg-slate-800 text-white flex justify-between items-center">
          <h3 className="font-bold">Editar Ubicaciones - {activeAlmacenId}</h3>
          <div className="flex items-center gap-4">
            {originalUnallocated > 0 && (
              <button 
                onClick={() => {
                  setConfirmDialog({
                    message: `¿Estás seguro de eliminar las ${originalUnallocated} piezas no asignadas de este artículo? Su stock se reducirá a ${originalAllocated}.`,
                    onConfirm: () => {
                      const formattedLocs = initialLocs.map(l => ({ pasillo: l.rawPasillo, qty: l.qty }));
                      onSave(product, formattedLocs, originalAllocated);
                    }
                  });
                }}
                className="text-xs font-bold bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded transition-colors shadow-sm"
              >
                Eliminar Sin Asignar
              </button>
            )}
            {originalUnallocated > 0 && appConfig.almacenes?.length > 1 && (
              <button 
                onClick={() => onTransfer(product)}
                className="text-xs font-bold bg-emerald-700 hover:bg-emerald-600 text-white px-3 py-1 rounded transition-colors shadow-sm flex items-center gap-1 border border-emerald-500"
                title="Transferir stock sin asignar a otro almacén"
              >
                <ArrowRightLeft className="w-3 h-3"/> Transferir
              </button>
            )}
            <button onClick={onClose} className="text-slate-400 hover:text-white ml-2"><X className="w-5 h-5"/></button>
          </div>
        </div>
        
        <div className="p-6 overflow-y-auto">
          <h2 className="text-lg font-black text-slate-800 leading-tight mb-2">{name}</h2>
          
          <div className="flex gap-4 mb-6 bg-slate-100 p-4 rounded-lg border border-slate-200">
            <div>
              <p className="text-xs text-slate-500 font-bold uppercase">Stock Almacén</p>
              <p className="text-2xl font-black text-slate-800">{totalStock}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 font-bold uppercase">Restante por asignar</p>
              <p className={`text-2xl font-black ${remaining < 0 ? 'text-red-500' : remaining === 0 ? 'text-emerald-500' : 'text-amber-500'}`}>{remaining}</p>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-bold text-slate-500 uppercase">Ubicaciones</label>
            {locs.map((loc, i) => {
              const floorOptions = [...activeFloors];
              if (loc.floorId === 'OTHER') {
                floorOptions.push({ id: 'OTHER', name: 'Ubicación Original' });
              }
              const availableAisles = activeAisles.filter(a => a.floorId === loc.floorId);

              return (
                <div key={i} className="flex gap-2 items-center bg-slate-50 p-2 rounded border border-slate-100">
                  <select 
                    className="flex-1 border border-slate-300 p-2 rounded text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    value={loc.floorId}
                    onChange={(e) => {
                       const newFloorId = e.target.value;
                       const newAisles = activeAisles.filter(a => a.floorId === newFloorId);
                       updateRow(i, {
                         floorId: newFloorId,
                         aisleId: newAisles.length > 0 ? newAisles[0].id : ''
                       });
                    }}
                  >
                    <option value="" disabled>Piso...</option>
                    {floorOptions.map(f => (
                      <option key={f.id} value={f.id}>{f.name || f.id}</option>
                    ))}
                  </select>

                  {loc.floorId === 'OTHER' ? (
                    <input 
                      type="text" 
                      className="flex-1 border border-slate-300 p-2 rounded text-sm opacity-50 cursor-not-allowed"
                      value={loc.rawPasillo.replace(activeAlmacenPrefix, '')}
                      disabled
                    />
                  ) : (
                    <select 
                      className="flex-1 border border-slate-300 p-2 rounded text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      value={loc.aisleId}
                      onChange={(e) => updateRow(i, { aisleId: e.target.value })}
                    >
                      <option value="" disabled>Pasillo...</option>
                      {availableAisles.map(a => (
                        <option key={a.id} value={a.id}>Pasillo {a.id}</option>
                      ))}
                    </select>
                  )}

                  <div className="flex items-center gap-1 w-20">
                    <span className="text-xs font-bold text-slate-400">Pos.</span>
                    <input 
                      type="number" 
                      min="1"
                      className="w-12 border border-slate-300 p-1 rounded text-sm text-center focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                      value={loc.posNum}
                      onChange={(e) => updateRow(i, { posNum: e.target.value })}
                    />
                  </div>

                  <input 
                    type="number" 
                    min="1"
                    className="w-20 border border-slate-300 p-2 rounded text-sm text-center font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                    value={loc.qty}
                    onChange={(e) => updateRow(i, { qty: parseInt(e.target.value, 10)||0 })}
                  />
                  <button onClick={() => removeRow(i)} className="text-red-500 p-1 hover:bg-red-50 rounded transition-colors"><X className="w-5 h-5"/></button>
                </div>
              );
            })}
            
            <button onClick={addRow} className="text-emerald-600 text-sm font-bold flex items-center gap-1 hover:bg-emerald-50 py-2 px-3 rounded w-max mt-2 transition-colors">
              <Plus className="w-4 h-4"/> Añadir ubicación
            </button>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={loading} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-300 text-white text-sm font-bold rounded shadow-sm flex items-center gap-2 transition-all">
            {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/> : <Save className="w-4 h-4"/>}
            Guardar
          </button>
        </div>
      </div>
      
      {confirmDialog && (
        <div className="fixed inset-0 bg-slate-900/60 z-[70] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden animate-in">
            <div className="p-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
               <AlertTriangle className="w-5 h-5 text-red-500" />
               <h4 className="font-bold text-slate-800">Confirmar Eliminación</h4>
            </div>
            <div className="p-5">
              <p className="text-slate-600 text-sm">{confirmDialog.message}</p>
            </div>
            <div className="p-4 bg-slate-50 border-t flex justify-end gap-3">
              <button onClick={() => setConfirmDialog(null)} className="px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded transition-colors">Cancelar</button>
              <button onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} className="px-4 py-2 text-sm font-bold text-white rounded bg-red-600 hover:bg-red-700 shadow-sm transition-colors">
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
