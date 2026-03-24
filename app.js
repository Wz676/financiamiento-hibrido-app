// ==========================================
// 1. 系统核心状态 (ESTADO GLOBAL)
// ==========================================
let appState = {
    saldoUSD: 0.00,
    transacciones: [],
    prestamoActivo: null // 用于永久记录用户当前成功的贷款状态
};

let tasaBCV = 36.35; 
let monedaVista = 'USD'; 
let calculoActual = null; 
let vehiculoSeleccionado = null;

const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbwf5gIZ_XQ19y_4jkSrHdtQMzbeFX0qECT62Of5BK0mLmDxsHj2mxAH6lvhSBiR3eZv/exec";

// ==========================================
// 2. 获取真实的 BCV 实时汇率 
// ==========================================
async function obtenerTasaBCV() {
    try {
        const response = await fetch('https://pydolarvenezuela-api.vercel.app/api/v1/dollar/page?page=bcv');
        if (!response.ok) throw new Error('Error en la red');
        const data = await response.json();
        const tasaReal = data.monitors.usd.price; 
        return parseFloat(tasaReal);
    } catch (error) {
        console.warn("API del BCV no disponible.", error);
        return 470.35; // 备用汇率
    }
}

// ==========================================
// 3. 智能数据加载与版本兼容 
// ==========================================
function cargarDatos() {
    const datos = localStorage.getItem('ecosistema_data');
    if (datos) {
        let datosGuardados = JSON.parse(datos);
        if (datosGuardados.saldo !== undefined && datosGuardados.saldoUSD === undefined) {
            appState.saldoUSD = datosGuardados.saldo; 
            appState.transacciones = datosGuardados.transacciones || [];
        } else {
            appState = datosGuardados; 
            if(appState.prestamoActivo === undefined) appState.prestamoActivo = null;
        }
    }
}

function guardarDatos() {
    localStorage.setItem('ecosistema_data', JSON.stringify(appState));
}

// ==========================================
// 4. 钱包基础功能 (UI与切换)
// ==========================================
window.toggleMoneda = function() {
    monedaVista = monedaVista === 'USD' ? 'BS' : 'USD';
    document.getElementById('texto-moneda').innerText = monedaVista === 'USD' ? 'Bolívares' : 'Dólares';
    actualizarInicio();
};

function actualizarInicio() {
    const saldoEl = document.getElementById('saldo-actual');
    if(saldoEl) {
        let saldoMostrar = monedaVista === 'USD' ? appState.saldoUSD : (appState.saldoUSD * tasaBCV);
        let simbolo = monedaVista === 'USD' ? '$' : 'Bs ';
        saldoEl.innerText = `${simbolo}${saldoMostrar.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    }

    const listaEl = document.getElementById('lista-transacciones');
    if(listaEl) {
        listaEl.innerHTML = '';
        const txs = [...appState.transacciones].reverse();
        
        if(txs.length === 0) {
            listaEl.innerHTML = '<div style="text-align:center; padding: 20px; color: gray; font-size: 14px;">Aún no tienes transacciones.</div>';
            return;
        }

        txs.forEach(tx => {
            const color = tx.tipo === 'ingreso' ? '#28a745' : '#dc3545';
            const signo = tx.tipo === 'ingreso' ? '+' : '-';
            const icono = tx.tipo === 'ingreso' ? 'md-long-arrow-down' : 'md-long-arrow-up';
            
            listaEl.innerHTML += `
                <ons-list-item>
                    <div class="left"><ons-icon icon="${icono}" style="color: ${color}; background: #f4f4f4; padding: 10px; border-radius: 50%;"></ons-icon></div>
                    <div class="center">
                        <span class="list-item__title" style="font-weight: bold; font-size: 14px;">${tx.concepto}</span>
                        <span class="list-item__subtitle" style="font-size: 12px; color: gray;">${tx.metodo} • ${tx.fecha}</span>
                    </div>
                    <div class="right" style="color: ${color}; font-weight: bold; font-size: 14px;">
                        ${signo}$${tx.montoUSD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                    </div>
                </ons-list-item>
            `;
        });
    }
}

// ==========================================
// 5. 充值与交易核心逻辑 (Fondeo)
// ==========================================
window.simularFondeo = function() {
    ons.openActionSheet({
        title: 'Seleccione un método de pago',
        cancelable: true,
        buttons: [
            { label: 'Pago Móvil (Bs)', icon: 'md-smartphone' },
            { label: 'Tarjeta Bancaria Nacional (Bs)', icon: 'md-card' },
            { label: 'Tarjeta Internacional (USD)', icon: 'md-globe' },
            { label: 'Criptomonedas (USDT)', icon: 'md-money-box' },
            { label: 'PayPal (USD)', icon: 'md-paypal' },
            { label: 'Cancelar', icon: 'md-close' }
        ]
    }).then(function(index) {
        if(index === 5 || index === -1) return;
        const metodos = [
            {nombre: 'Pago Móvil', moneda: 'BS'},
            {nombre: 'Tarjeta Nacional', moneda: 'BS'},
            {nombre: 'Tarjeta Internacional', moneda: 'USD'},
            {nombre: 'Cripto (USDT)', moneda: 'USD'},
            {nombre: 'PayPal', moneda: 'USD'}
        ];
        pedirMonto(metodos[index]);
    });
};

function pedirMonto(metodoObj) {
    let monedaTexto = metodoObj.moneda === 'BS' ? 'Bolívares (Bs)' : 'Dólares (USD)';
    ons.notification.prompt({
        message: `Ingrese el monto en <b>${monedaTexto}</b>:`,
        title: `Fondeo: ${metodoObj.nombre}`,
        buttonLabel: 'Siguiente',
        cancelable: true
    }).then(function(input) {
        const montoOriginal = parseFloat(input);
        if (montoOriginal > 0) {
            if (metodoObj.moneda === 'BS') {
                let montoConvertidoUSD = montoOriginal / tasaBCV;
                ons.notification.confirm({
                    message: `Tasa BCV: <b>${tasaBCV}</b><br><br>Monto: Bs ${montoOriginal.toLocaleString()}<br>Acreditado en billetera: <b style="color:#28a745;">$${montoConvertidoUSD.toFixed(2)}</b>`,
                    title: 'Confirmar Conversión',
                    buttonLabels: ['Cancelar', 'Aceptar']
                }).then(function(res) {
                    if (res === 1) ejecutarTransaccion(metodoObj.nombre, montoConvertidoUSD);
                });
            } else {
                ejecutarTransaccion(metodoObj.nombre, montoOriginal);
            }
        }
    });
}

function ejecutarTransaccion(metodoNombre, montoUSD) {
    ons.notification.toast(`Procesando pago vía ${metodoNombre}...`, { timeout: 1500 });
    setTimeout(() => {
        const nuevaTx = {
            id: 'TXN-' + Math.floor(Math.random() * 1000000),
            tipo: 'ingreso',
            metodo: metodoNombre,
            concepto: 'Fondeo de Billetera',
            montoUSD: montoUSD,
            fecha: new Date().toLocaleDateString()
        };
        appState.saldoUSD += montoUSD;
        appState.transacciones.push(nuevaTx);
        guardarDatos();
        actualizarInicio();
        enviarAGoogleSheets(nuevaTx);
        ons.notification.toast('¡Fondeo exitoso!', { timeout: 2000, animation: 'ascend' });
    }, 1500);
}

function enviarAGoogleSheets(txData) {
    if(!GOOGLE_SHEETS_URL || GOOGLE_SHEETS_URL.includes("在这里粘贴")) return;
    const dataAEnviar = {
        id: txData.id,
        metodo: txData.metodo,
        concepto: txData.concepto,
        monto: txData.montoUSD
    };
    fetch(GOOGLE_SHEETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(dataAEnviar)
    }).catch(error => console.error("Error GSheets:", error));
}

// ==========================================
// 6. 智能支出系统 (Transferir y Pagar)
// ==========================================
window.simularTransferencia = function() {
    if (appState.saldoUSD <= 0) {
        ons.notification.alert('No tienes saldo suficiente para transferir.');
        return;
    }
    ons.notification.prompt({
        message: 'Ingrese el correo o teléfono del destinatario:',
        title: 'Transferir Fondos',
        buttonLabel: 'Siguiente',
        cancelable: true
    }).then(function(destinatario) {
        if (destinatario) pedirMontoEgreso('Transferencia a', destinatario);
    });
};

window.simularPago = function() {
    if (appState.saldoUSD <= 0) {
        ons.notification.alert('No tienes saldo suficiente para realizar pagos.');
        return;
    }
    ons.openActionSheet({
        title: 'Seleccione un servicio a pagar',
        cancelable: true,
        buttons: [
            { label: 'Cuota de Vehículo (Híbrido)', icon: 'md-car' },
            { label: 'Seguro Automotriz', icon: 'md-shield-check' },
            { label: 'Escanear QR en Comercio', icon: 'md-center-focus-strong' },
            { label: 'Cancelar', icon: 'md-close' }
        ]
    }).then(function(index) {
        if(index === 3 || index === -1) return;
        
        // 场景 1：支付汽车月供
        if (index === 0) {
            if (!appState.prestamoActivo) {
                ons.notification.alert('No tienes ningún financiamiento activo.');
                return;
            }
            if (appState.prestamoActivo.cuotasRestantes <= 0) {
                ons.notification.alert('¡Ya has pagado todas las cuotas!');
                return;
            }
            
            const montoAPagar = appState.prestamoActivo.cuotaMensual;
            const msj = `<div style="text-align:left; margin-top:10px;">
                            <p style="color:gray; font-size:12px; margin:0;">Servicio:</p>
                            <h4 style="margin:0 0 10px 0;">Mensualidad Vehículo (${appState.prestamoActivo.cuotasRestantes} restantes)</h4>
                            <p style="color:gray; font-size:12px; margin:0;">Monto a debitar:</p>
                            <h2 style="color:#4a90e2; margin:0;">$${montoAPagar.toFixed(2)}</h2>
                         </div>`;
                         
            ons.notification.confirm({
                message: msj,
                title: 'Confirmar Pago',
                buttonLabels: ['Cancelar', 'Pagar Ahora']
            }).then(res => {
                if(res === 1) {
                    if(appState.saldoUSD < montoAPagar) {
                        ons.notification.alert('Saldo insuficiente.'); return;
                    }
                    ejecutarEgreso('Pago de Cuota', 'Cuota de Vehículo', montoAPagar);
                    appState.prestamoActivo.cuotasRestantes -= 1; 
                    guardarDatos();
                    if(document.getElementById('page-perfil')) renderizarDashboard();
                }
            });
        } 
        // 场景 2：支付汽车保险 
        else if (index === 1) {
            const montoSeguro = 45.00; 
            const msjSeguro = `<div style="text-align:left; margin-top:10px;">
                                <p style="color:gray; font-size:12px; margin:0;">Servicio:</p>
                                <h4 style="margin:0 0 10px 0;">Seguro Automotriz</h4>
                                <p style="color:gray; font-size:12px; margin:0;">Monto a debitar:</p>
                                <h2 style="color:#4a90e2; margin:0;">$${montoSeguro.toFixed(2)}</h2>
                               </div>`;
                               
            ons.notification.confirm({
                message: msjSeguro,
                title: 'Confirmar Pago',
                buttonLabels: ['Cancelar', 'Pagar Ahora']
            }).then(res => {
                if(res === 1) {
                    if(appState.saldoUSD < montoSeguro) {
                        ons.notification.alert('Saldo insuficiente.'); return;
                    }
                    ejecutarEgreso('Pago de Seguro', 'Seguro Automotriz', montoSeguro);
                }
            });
        }
        // 场景 3：扫码付款
        else if (index === 2) {
            ons.notification.prompt({
                message: `Ingrese el monto a pagar (USD):`,
                title: 'Pago QR',
                buttonLabel: 'Confirmar'
            }).then(input => {
                const monto = parseFloat(input);
                if (monto > 0 && monto <= appState.saldoUSD) {
                    ejecutarEgreso('Pago en Comercio', 'Pago QR', monto);
                } else if (monto > appState.saldoUSD) {
                    ons.notification.alert('Saldo insuficiente.');
                }
            });
        }
    });
};

function pedirMontoEgreso(tipoOperacion, detalle) {
    ons.notification.prompt({
        message: `Monto en <b>USD</b> para:<br><span style="color:gray;">${detalle}</span>`,
        title: 'Monto a debitar',
        buttonLabel: 'Confirmar'
    }).then(function(input) {
        const montoOperacion = parseFloat(input);
        if (montoOperacion > 0) {
            if (montoOperacion > appState.saldoUSD) {
                ons.notification.alert(`Fondos insuficientes.`);
            } else {
                ejecutarEgreso(tipoOperacion, detalle, montoOperacion);
            }
        }
    });
}

function ejecutarEgreso(tipoOperacion, detalle, montoUSD) {
    ons.notification.toast(`Procesando transacción...`, { timeout: 1500 });
    setTimeout(() => {
        const nuevaTx = {
            id: 'TXN-' + Math.floor(Math.random() * 1000000),
            tipo: 'egreso',
            metodo: tipoOperacion,
            concepto: detalle,
            montoUSD: montoUSD,
            fecha: new Date().toLocaleDateString()
        };
        appState.saldoUSD -= montoUSD;
        appState.transacciones.push(nuevaTx);
        guardarDatos();
        actualizarInicio();
        enviarAGoogleSheets(nuevaTx);
        ons.notification.toast('¡Operación exitosa!', { timeout: 2000, animation: 'ascend' });
    }, 1500);
}

// ==========================================
// 7. 虚拟车库与计算器 (Catálogo y Simulador)
// ==========================================
const baseDeDatosVehiculos = [
    { id: 'v1', marca: 'Toyota', modelo: 'Corolla', anio: 2018, precio: 15000, img: 'https://placehold.co/300x200/ffffff/4a90e2?text=Toyota+Corolla' },
    { id: 'v2', marca: 'Ford', modelo: 'Fiesta', anio: 2016, precio: 7500, img: 'https://placehold.co/300x200/ffffff/4a90e2?text=Ford+Fiesta' },
    { id: 'v3', marca: 'Hyundai', modelo: 'Tucson', anio: 2020, precio: 22000, img: 'https://placehold.co/300x200/ffffff/4a90e2?text=Hyundai+Tucson' },
    { id: 'v4', marca: 'Chevrolet', modelo: 'Spark', anio: 2015, precio: 5000, img: 'https://placehold.co/300x200/ffffff/4a90e2?text=Chevrolet+Spark' }
];


function renderizarCatalogo() {
    const contenedor = document.getElementById('catalogo-vehiculos');
    if (!contenedor) return;
    
    contenedor.innerHTML = ''; 
    baseDeDatosVehiculos.forEach(auto => {
        const tarjeta = document.createElement('div');
        tarjeta.id = `tarjeta-${auto.id}`;
        tarjeta.style.cssText = `
            min-width: 140px; background: white; border-radius: 10px; 
            box-shadow: 0 2px 5px rgba(0,0,0,0.1); overflow: hidden; 
            cursor: pointer; transition: transform 0.2s, border 0.2s;
            border: 2px solid transparent;
        `;
        tarjeta.onclick = () => seleccionarVehiculo(auto);
        tarjeta.innerHTML = `
            <div style="height: 80px; background-image: url('${auto.img}'); background-size: cover; background-position: center;"></div>
            <div style="padding: 10px;">
                <p style="margin: 0; font-size: 12px; color: gray;">${auto.marca} • ${auto.anio}</p>
                <h4 style="margin: 2px 0 5px 0; font-size: 14px; color: #0a2540;">${auto.modelo}</h4>
                <p style="margin: 0; font-weight: bold; color: #28a745; font-size: 13px;">$${auto.precio.toLocaleString()}</p>
            </div>
        `;
        contenedor.appendChild(tarjeta);
    });
}

window.seleccionarVehiculo = function(auto) {
    vehiculoSeleccionado = auto;
    baseDeDatosVehiculos.forEach(v => {
        const t = document.getElementById(`tarjeta-${v.id}`);
        if(t) t.style.border = '2px solid transparent';
    });
    const tSel = document.getElementById(`tarjeta-${auto.id}`);
    if(tSel) tSel.style.border = '2px solid #00d4ff';
    
    document.getElementById('monto-vehiculo').value = auto.precio;
    ons.notification.toast(`Seleccionaste: ${auto.marca} ${auto.modelo}`, { timeout: 1000 });
    calcularEcosistema();
};

window.limpiarSeleccion = function() {
    vehiculoSeleccionado = null;
    baseDeDatosVehiculos.forEach(v => {
        const t = document.getElementById(`tarjeta-${v.id}`);
        if(t) t.style.border = '2px solid transparent';
    });
};

window.calcularEcosistema = function() {
    const inputMonto = document.getElementById('monto-vehiculo').value;
    const montoVehiculo = parseFloat(inputMonto);
    
    if (!montoVehiculo || montoVehiculo < 1000) return;

    const entradaEl = document.getElementById('rango-entrada');
    const porcentajeEntrada = entradaEl ? parseFloat(entradaEl.value) : 30; 
    
    const mesesSelect = document.getElementById('plazo-meses');
    const meses = mesesSelect ? parseInt(mesesSelect.value) : 24; 
    
    const montoEntrada = montoVehiculo * (porcentajeEntrada / 100);
    const cuotaBalloon = montoVehiculo * 0.30;
    const capitalFinanciar = montoVehiculo - montoEntrada - cuotaBalloon;
    
    const tasaInteresTotal = meses * 0.01; 
    const totalFinanciado = capitalFinanciar * (1 + tasaInteresTotal);
    const cuotaMensualUSD = totalFinanciado / meses;
    const cuotaMensualBS = cuotaMensualUSD * tasaBCV; 

    calculoActual = {
        montoVehiculo: montoVehiculo,
        montoEntrada: montoEntrada,
        cuotaBalloon: cuotaBalloon,
        cuotaMensualUSD: cuotaMensualUSD
    };

    const reEnt = document.getElementById('res-entrada');
    if(reEnt) reEnt.innerText = `$${montoEntrada.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    const reBal = document.getElementById('res-balloon');
    if(reBal) reBal.innerText = `$${cuotaBalloon.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    const reUsd = document.getElementById('res-cuota-usd');
    if(reUsd) reUsd.innerText = `$${cuotaMensualUSD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    const reBs = document.getElementById('res-cuota-bs');
    if(reBs) reBs.innerText = `Bs ${cuotaMensualBS.toLocaleString('es-VE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    const textoMeses = document.getElementById('texto-meses-resultado');
    if(textoMeses) textoMeses.innerText = `(Financiado a ${meses} meses)`;

    const btnPagar = document.getElementById('btn-pagar-entrada');
    if(btnPagar) btnPagar.style.display = 'block';
};

window.pagarEntradaDirecto = function() {
    if (!calculoActual) return;
    const montoRequerido = calculoActual.montoEntrada;

    if (appState.saldoUSD < montoRequerido) {
        ons.notification.confirm({
            message: `Saldo insuficiente para pagar la entrada de $${montoRequerido.toLocaleString()}.<br>¿Ir a fondear?`,
            title: 'Fondos Insuficientes',
            buttonLabels: ['Cancelar', 'Ir a Fondear']
        }).then(function(res) {
            if (res === 1) {
                document.querySelector('ons-tabbar').setActiveTab(0);
                setTimeout(() => simularFondeo(), 500);
            }
        });
        return;
    }

    ons.notification.confirm({
        message: `Se debitarán <b>$${montoRequerido.toLocaleString()}</b> de tu cartera para reservar el vehículo.`,
        title: 'Confirmar Reserva',
        buttonLabels: ['Cancelar', 'Aprobar Contrato']
    }).then(function(res) {
        if (res === 1) {
            ejecutarEgreso('Contrato Inteligente', 'Pago de Entrada', montoRequerido);
            
            const mesesSelect = document.getElementById('plazo-meses');
            appState.prestamoActivo = {
                montoTotal: calculoActual.montoVehiculo,
                entrada: calculoActual.montoEntrada,
                balloon: calculoActual.cuotaBalloon,
                cuotaMensual: calculoActual.cuotaMensualUSD,
                cuotasRestantes: mesesSelect ? parseInt(mesesSelect.value) : 24
            };
            guardarDatos();
            
            setTimeout(() => {
                document.querySelector('ons-tabbar').setActiveTab(2);
                renderizarDashboard(); 
            }, 2000);
        }
    });
};

// ==========================================
// 8. DASHBOARD & KYC (个人看板与图表)
// ==========================================
let graficoInstancia = null; 

window.iniciarKYC = function() {
    ons.notification.confirm({
        message: 'Para desbloquear el financiamiento, necesitamos escanear su identidad. ¿Comenzar?',
        title: 'KYC',
        buttonLabels: ['Más tarde', 'Escanear']
    }).then(function(res) {
        if (res === 1) {
            ons.notification.toast('Analizando biometría...', { timeout: 2500 });
            setTimeout(() => {
                const badge = document.getElementById('kyc-status-badge');
                const btn = document.getElementById('btn-kyc');
                if(badge) {
                    badge.className = 'badge-verified';
                    badge.innerText = 'Identidad Verificada';
                }
                if(btn) btn.style.display = 'none'; 
                
                const score = document.getElementById('score-numero');
                if(score) score.innerText = '820'; 
                
                ons.notification.alert({ title: '¡Aprobado!', message: 'Límite de crédito aumentado.' });
            }, 2500);
        }
    });
};

function renderizarDashboard() {
    const ctx = document.getElementById('graficoFinanciamiento');
    if (!ctx) return;
    
    if (graficoInstancia) graficoInstancia.destroy();

    let datosGrafico = [];
    let montoTotal = 0;
    const leyendaEl = document.getElementById('chart-leyenda');
    const lista = document.getElementById('lista-vencimientos');

    if (appState.prestamoActivo) {
        const p = appState.prestamoActivo;
        const sumatoriaCuotas = p.cuotaMensual * p.cuotasRestantes;
        datosGrafico = [p.entrada, sumatoriaCuotas, p.balloon];
        montoTotal = p.montoTotal;
        
        if(leyendaEl) {
            leyendaEl.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:5px;">
                    <span style="color:#28a745; font-weight:700;">● Entrada</span>
                    <span style="font-weight:700;">$${p.entrada.toLocaleString('en-US', {minimumFractionDigits:2})}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:5px;">
                    <span style="color:#4a90e2; font-weight:700;">● Cuotas (${p.cuotasRestantes} meses)</span>
                    <span style="font-weight:700;">$${sumatoriaCuotas.toLocaleString('en-US', {minimumFractionDigits:2})}</span>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:11px;">
                    <span style="color:#94a3b8; font-weight:700;">● Balloon</span>
                    <span style="font-weight:700;">$${p.balloon.toLocaleString('en-US', {minimumFractionDigits:2})}</span>
                </div>
            `;
        }

        if(lista) {
            lista.innerHTML = `
                <ons-list-item>
                    <div class="left"><ons-icon icon="md-car" style="color: #4a90e2;"></ons-icon></div>
                    <div class="center">
                        <span class="list-item__title" style="font-weight: 600; font-size: 13px;">Mensualidad Vehículo</span>
                        <span class="list-item__subtitle" style="font-size: 11px; color:#f59e0b;">Vence en 15 días</span>
                    </div>
                    <div class="right" style="font-weight: 700;">$${p.cuotaMensual.toFixed(2)}</div>
                </ons-list-item>
                <ons-list-item>
                    <div class="left"><ons-icon icon="md-shield-check" style="color: #28a745;"></ons-icon></div>
                    <div class="center">
                        <span class="list-item__title" style="font-weight: 600; font-size: 13px;">Seguro Automotriz</span>
                        <span class="list-item__subtitle" style="font-size: 11px;">Renovación mensual</span>
                    </div>
                    <div class="right" style="font-weight: 700;">$45.00</div>
                </ons-list-item>
            `;
        }
    } else {
        datosGrafico = [1, 1, 1]; 
        document.getElementById('chart-total-value').innerText = '$0';
        if(leyendaEl) leyendaEl.innerHTML = '';
        if(lista) lista.innerHTML = `<div style="text-align:center; padding: 20px; color: gray; font-size: 12px;">No tienes servicios activos.</div>`;
    }

    if (appState.prestamoActivo) {
        document.getElementById('chart-total-value').innerText = `$${montoTotal.toLocaleString()}`;
    }

    graficoInstancia = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Entrada', 'Cuotas', 'Balloon'],
            datasets: [{
                data: datosGrafico,
                backgroundColor: appState.prestamoActivo ? ['#28a745', '#4a90e2', '#94a3b8'] : ['#edf2f7', '#edf2f7', '#edf2f7'],
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%', 
            plugins: {
                legend: { display: false } 
            }
        }
    });
}

// ==========================================
// 9. INICIALIZACIÓN Y EVENTOS (系统启动引擎)
// ==========================================
document.addEventListener('init', async function(event) {
    if (event.target.id === 'page-inicio') {
        tasaBCV = await obtenerTasaBCV(); 
        const tasaDisplay = document.getElementById('tasa-bcv-display');
        if(tasaDisplay) tasaDisplay.innerText = tasaBCV.toFixed(2); 
        cargarDatos();
        actualizarInicio();
    }
    
    if (event.target.id === 'page-simulador') {
        renderizarCatalogo();
        const tasaEl = document.getElementById('tasa-bcv-simulador');
        if(tasaEl) tasaEl.innerText = tasaBCV.toFixed(2);
    }
    
    if (event.target.id === 'page-perfil') {
        renderizarDashboard();
    }
});

window.resetearApp = function() {
    ons.notification.confirm({
        message: '¿Borrar todo el historial y volver a $0.00?',
        title: 'Advertencia',
        buttonLabels: ['Cancelar', 'Borrar']
    }).then(function(res) {
        if (res === 1) { 
            localStorage.removeItem('ecosistema_data');
            ons.notification.toast('Borrando...', { timeout: 1500 });
            setTimeout(() => { location.reload(); }, 1500);
        }
    });
};