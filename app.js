// ==========================================
// 1. 系统核心状态 (ESTADO GLOBAL)
// ==========================================
let appState = {
    saldoUSD: 0.00,
    transacciones: [],
    prestamoActivo: null,
    serviciosActivos: [], // 【新增】用户开通的额外服务（如保险）
    pagosRealizados: []   // 【新增】存放成功支付的账单记录
};

let tasaBCV = 470.35; 
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
            // 【安全升级】确保旧用户的数据库里也会自动生成这两个新数组
            if(!appState.prestamoActivo) appState.prestamoActivo = null;
            if(!appState.serviciosActivos) appState.serviciosActivos = [];
            if(!appState.pagosRealizados) appState.pagosRealizados = [];
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

// ==========================================
// 【新增】更多服务模块 (Hub de Servicios)
// ==========================================
window.abrirServicios = function() {
    ons.openActionSheet({
        title: 'Catálogo de Servicios Financieros',
        cancelable: true,
        buttons: [
            { label: 'Seguro Automotriz ($45/mes)', icon: 'md-shield-check' },
            { label: 'Crédito Personal ($50/mes)', icon: 'md-balance-wallet' },
            { label: 'Cancelar', icon: 'md-close' }
        ]
    }).then(index => {
        if (index === 0) contratarServicio('seguro_auto', 'Seguro Automotriz', 45, '#28a745');
        if (index === 1) contratarServicio('credito_personal', 'Crédito Personal', 50, '#f59e0b');
    });
};

function contratarServicio(id, nombre, cuota, color) {
    // 检查是否已经开通过
    if (appState.serviciosActivos.some(s => s.id === id)) {
        ons.notification.alert(`Ya tienes activo el servicio: ${nombre}`);
        return;
    }
    ons.notification.confirm({
        message: `¿Deseas activar <b>${nombre}</b> por $${cuota.toFixed(2)} mensuales?`,
        title: 'Activar Servicio'
    }).then(res => {
        if(res === 1) {
            appState.serviciosActivos.push({ id, nombre, cuota, color, proximoVencimiento: 'En 30 días' });
            guardarDatos();
            ons.notification.toast('Servicio activado exitosamente', { timeout: 2000 });
            if(document.getElementById('page-perfil')) renderizarDashboard();
        }
    });
}

window.simularPago = function() {
    if (appState.saldoUSD <= 0) {
        ons.notification.alert('No tienes saldo suficiente para realizar pagos.');
        return;
    }

    // 智能动态生成用户的“待付款账单”
    let opcionesPago = [];
    
    // 1. 如果有车贷
    if (appState.prestamoActivo && appState.prestamoActivo.cuotasRestantes > 0) {
        opcionesPago.push({ 
            label: `Mensualidad Vehículo ($${appState.prestamoActivo.cuotaMensual.toFixed(2)})`, 
            icon: 'md-car',
            action: () => procesarPagoInteligente('Cuota de Vehículo', appState.prestamoActivo.cuotaMensual, () => {
                appState.prestamoActivo.cuotasRestantes -= 1;
            })
        });
    }

    // 2. 如果开通了其他服务（保险、个贷等）
    appState.serviciosActivos.forEach(servicio => {
        // 如果这个月还没付过
        if (servicio.proximoVencimiento !== 'Pagado este mes') {
            opcionesPago.push({
                label: `${servicio.nombre} ($${servicio.cuota.toFixed(2)})`,
                icon: 'md-check-circle',
                action: () => procesarPagoInteligente(servicio.nombre, servicio.cuota, () => {
                    servicio.proximoVencimiento = 'Pagado este mes'; // 更新状态
                })
            });
        }
    });

    // 3. 永远保留的扫码支付
    opcionesPago.push({ label: 'Escanear QR Comercio', icon: 'md-center-focus-strong', action: pagarQR });
    opcionesPago.push({ label: 'Cancelar', icon: 'md-close', action: () => {} });

    // 弹出用户的真实账单
    if (opcionesPago.length === 2) { // 只有扫码和取消，说明没账单
        ons.notification.alert('¡Estás al día! No tienes deudas ni servicios pendientes de pago.');
        return;
    }

    ons.openActionSheet({
        title: 'Seleccione un recibo pendiente',
        cancelable: true,
        buttons: opcionesPago.map(o => ({ label: o.label, icon: o.icon }))
    }).then(index => {
        if (index !== -1 && opcionesPago[index]) {
            opcionesPago[index].action();
        }
    });
};

function procesarPagoInteligente(nombreServicio, monto, callbackExito) {
    ons.notification.confirm({
        message: `Se debitarán <b>$${monto.toFixed(2)}</b> por el pago de: <br>${nombreServicio}`,
        title: 'Confirmar Pago',
        buttonLabels: ['Cancelar', 'Pagar Ahora']
    }).then(res => {
        if(res === 1) {
            if(appState.saldoUSD < monto) {
                ons.notification.alert('Saldo insuficiente.'); return;
            }
            ejecutarEgreso('Pago de Servicio', nombreServicio, monto);
            
            // 【核心：转移到已付款记录】
            appState.pagosRealizados.push({
                nombre: nombreServicio,
                monto: monto,
                fecha: new Date().toLocaleDateString()
            });
            
            callbackExito(); // 执行更新逻辑（如减扣期数）
            guardarDatos();
            if(document.getElementById('page-perfil')) renderizarDashboard();
        }
    });
}

function pagarQR() {
    ons.notification.prompt({ message: `Ingrese el monto (USD):`, title: 'Pago QR', buttonLabel: 'Confirmar' })
    .then(input => {
        const monto = parseFloat(input);
        if (monto > 0 && monto <= appState.saldoUSD) ejecutarEgreso('Pago en Comercio', 'Pago QR', monto);
    });
}

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

// ==========================================
// 【重构核心】看板与图表 (Distribución de Gastos Mensuales)
// ==========================================
function renderizarDashboard() {
    const ctx = document.getElementById('graficoFinanciamiento');
    if (!ctx) return;
    if (graficoInstancia) graficoInstancia.destroy();

    // 将图表升级为：“我的每月固定支出结构”
    let labelsGrafico = [];
    let datosGrafico = [];
    let coloresGrafico = [];
    let totalMensual = 0;

    const listaVencimientos = document.getElementById('lista-vencimientos');
    const listaPagados = document.getElementById('lista-pagados');
    const leyendaEl = document.getElementById('chart-leyenda');

    if(listaVencimientos) listaVencimientos.innerHTML = '';
    if(listaPagados) listaPagados.innerHTML = '';
    if(leyendaEl) leyendaEl.innerHTML = '';

    // 1. 注入车贷数据
    if (appState.prestamoActivo && appState.prestamoActivo.cuotasRestantes > 0) {
        const cuotaAuto = appState.prestamoActivo.cuotaMensual;
        labelsGrafico.push('Vehículo');
        datosGrafico.push(cuotaAuto);
        coloresGrafico.push('#4a90e2');
        totalMensual += cuotaAuto;

        if(listaVencimientos) listaVencimientos.innerHTML += `
            <ons-list-item>
                <div class="left"><ons-icon icon="md-car" style="color: #4a90e2;"></ons-icon></div>
                <div class="center">
                    <span class="list-item__title" style="font-weight: 600; font-size: 13px;">Mensualidad Vehículo</span>
                    <span class="list-item__subtitle" style="font-size: 11px; color:#f59e0b;">Faltan ${appState.prestamoActivo.cuotasRestantes} cuotas</span>
                </div>
                <div class="right" style="font-weight: 700;">$${cuotaAuto.toFixed(2)}</div>
            </ons-list-item>
        `;
    }

    // 2. 注入新增服务数据
    appState.serviciosActivos.forEach(s => {
        labelsGrafico.push(s.nombre);
        datosGrafico.push(s.cuota);
        coloresGrafico.push(s.color);
        totalMensual += s.cuota;

        if(listaVencimientos) listaVencimientos.innerHTML += `
            <ons-list-item>
                <div class="left"><ons-icon icon="md-check-circle" style="color: ${s.color};"></ons-icon></div>
                <div class="center">
                    <span class="list-item__title" style="font-weight: 600; font-size: 13px;">${s.nombre}</span>
                    <span class="list-item__subtitle" style="font-size: 11px; color: ${s.proximoVencimiento === 'Pagado este mes' ? '#28a745' : 'gray'};">${s.proximoVencimiento}</span>
                </div>
                <div class="right" style="font-weight: 700;">$${s.cuota.toFixed(2)}</div>
            </ons-list-item>
        `;
    });

    // 3. 渲染已付款记录
    const pagosMes = [...appState.pagosRealizados].reverse(); // 最新的在最上面
    if (pagosMes.length > 0) {
        pagosMes.forEach(pago => {
            if(listaPagados) listaPagados.innerHTML += `
                <ons-list-item>
                    <div class="left"><ons-icon icon="md-check-all" style="color: #28a745;"></ons-icon></div>
                    <div class="center">
                        <span class="list-item__title" style="font-weight: 600; font-size: 13px; text-decoration: line-through; color: gray;">${pago.nombre}</span>
                        <span class="list-item__subtitle" style="font-size: 11px;">Pagado el ${pago.fecha}</span>
                    </div>
                    <div class="right" style="font-weight: 700; color: #28a745;">$${pago.monto.toFixed(2)}</div>
                </ons-list-item>
            `;
        });
    } else {
        if(listaPagados) listaPagados.innerHTML = `<div style="text-align:center; padding: 10px; color: gray; font-size: 12px;">No has realizado pagos este mes.</div>`;
    }

    // 图表数据兜底 (如果没有服务)
    if (datosGrafico.length === 0) {
        datosGrafico = [1];
        coloresGrafico = ['#edf2f7'];
        if(listaVencimientos) listaVencimientos.innerHTML = `<div style="text-align:center; padding: 20px; color: gray; font-size: 12px;">No tienes servicios activos.</div>`;
    } else {
        // 生成极简图例
        labelsGrafico.forEach((label, i) => {
            if(leyendaEl) leyendaEl.innerHTML += `
                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:5px;">
                    <span style="color:${coloresGrafico[i]}; font-weight:700;">● ${label}</span>
                    <span style="font-weight:700;">$${datosGrafico[i].toFixed(2)}</span>
                </div>
            `;
        });
    }

    const totalEl = document.getElementById('chart-total-value');
    if(totalEl) totalEl.innerText = `$${totalMensual.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    // 绘制图表 (加入智能金额格式化拦截器)
    graficoInstancia = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labelsGrafico,
            datasets: [{
                data: datosGrafico,
                backgroundColor: coloresGrafico,
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '75%', 
            plugins: { 
                legend: { display: false },
                // 【核心修复】强行接管鼠标悬浮/手指点击图表时弹出的黑框，格式化为 2 位小数
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.raw !== null) {
                                // 强制转换为标准的 2 位小数货币格式
                                label += '$' + parseFloat(context.raw).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
                            }
                            return label;
                        }
                    }
                }
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