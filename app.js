// ==========================================
// 1. 系统核心状态
// ==========================================
let appState = {
    saldoUSD: 0.00, // 底层永远以 USD 记账
    transacciones: []
};

let tasaBCV = 470.35; // 模拟当天官方汇率
let monedaVista = 'USD'; // 当前界面的显示货币状态 ('USD' 或 'BS')
let calculoActual = null; // 临时保存当前计算出的方案结果

// 【重要】粘贴你的 Google Apps Script URL
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbwf5gIZ_XQ19y_4jkSrHdtQMzbeFX0qECT62Of5BK0mLmDxsHj2mxAH6lvhSBiR3eZv/exec";

// ==========================================
// 2. 获取真实的 BCV 实时汇率 (Conexión a API real con Fallback)
// ==========================================
async function obtenerTasaBCV() {
    try {
        const response = await fetch('https://pydolarvenezuela-api.vercel.app/api/v1/dollar/page?page=bcv');
        if (!response.ok) throw new Error('Error en la red');
        const data = await response.json();
        const tasaReal = data.monitors.usd.price; 
        console.log("Tasa BCV obtenida en tiempo real:", tasaReal);
        return parseFloat(tasaReal);
    } catch (error) {
        console.warn("API del BCV no disponible. Usando tasa de respaldo.", error);
        ons.notification.toast('Usando tasa BCV de respaldo por fallo de conexión', { timeout: 3000 });
        return 470.35; // 备用汇率
    }
}

// ==========================================
// 3. 智能数据加载与版本兼容 (Migración de datos)
// ==========================================
function cargarDatos() {
    const datos = localStorage.getItem('ecosistema_data');
    if (datos) {
        let datosGuardados = JSON.parse(datos);
        if (datosGuardados.saldo !== undefined && datosGuardados.saldoUSD === undefined) {
            appState.saldoUSD = datosGuardados.saldo; 
            appState.transacciones = datosGuardados.transacciones || [];
            console.log("Migración de datos completada.");
        } else {
            appState = datosGuardados; 
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
            
            const itemHTML = `
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
            listaEl.innerHTML += itemHTML;
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
// 6. 支出系统 (Transferir y Pagar)
// ==========================================
window.simularTransferencia = function() {
    if (appState.saldoUSD <= 0) {
        ons.notification.alert('No tienes saldo suficiente para transferir. Por favor, fondea tu cuenta primero.');
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
        const servicios = ['Cuota de Vehículo', 'Seguro Automotriz', 'Pago en Comercio QR'];
        pedirMontoEgreso('Pago de Servicio', servicios[index]);
    });
};

function pedirMontoEgreso(tipoOperacion, detalle) {
    ons.notification.prompt({
        message: `Ingrese el monto en <b>Dólares (USD)</b> para:<br><br><span style="color:gray;">${detalle}</span>`,
        title: 'Monto a debitar',
        buttonLabel: 'Confirmar',
        cancelable: true
    }).then(function(input) {
        const montoOperacion = parseFloat(input);
        if (montoOperacion > 0) {
            if (montoOperacion > appState.saldoUSD) {
                ons.notification.alert(`<b>Fondos insuficientes.</b><br>Tu saldo actual es de $${appState.saldoUSD.toFixed(2)} USD.`);
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
// 修复图片：使用极稳定的高清占位图服务
const baseDeDatosVehiculos = [
    { id: 'v1', marca: 'Toyota', modelo: 'Corolla', anio: 2018, precio: 15000, img: 'https://placehold.co/300x200/0a2540/FFF?text=Toyota+Corolla' },
    { id: 'v2', marca: 'Ford', modelo: 'Fiesta', anio: 2016, precio: 7500, img: 'https://placehold.co/300x200/0a2540/FFF?text=Ford+Fiesta' },
    { id: 'v3', marca: 'Hyundai', modelo: 'Tucson', anio: 2020, precio: 22000, img: 'https://placehold.co/300x200/0a2540/FFF?text=Hyundai+Tucson' },
    { id: 'v4', marca: 'Chevrolet', modelo: 'Spark', anio: 2015, precio: 5000, img: 'https://placehold.co/300x200/0a2540/FFF?text=Chevrolet+Spark' }
];

let vehiculoSeleccionado = null;

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
        document.getElementById(`tarjeta-${v.id}`).style.border = '2px solid transparent';
    });
    document.getElementById(`tarjeta-${auto.id}`).style.border = '2px solid #00d4ff';
    document.getElementById('monto-vehiculo').value = auto.precio;
    ons.notification.toast(`Seleccionaste: ${auto.marca} ${auto.modelo}`, { timeout: 1000 });
    calcularEcosistema();
};

window.limpiarSeleccion = function() {
    vehiculoSeleccionado = null;
    baseDeDatosVehiculos.forEach(v => {
        const tarjeta = document.getElementById(`tarjeta-${v.id}`);
        if(tarjeta) tarjeta.style.border = '2px solid transparent';
    });
};

// 【核心修复】：加入了下拉选择期数(mesesSelect)的动态算法
window.calcularEcosistema = function() {
    const inputMonto = document.getElementById('monto-vehiculo').value;
    const montoVehiculo = parseFloat(inputMonto);
    
    // 如果没有输入有效金额，静默返回，不打断滑块
    if (!montoVehiculo || montoVehiculo < 1000) return;

    const porcentajeEntrada = parseFloat(document.getElementById('rango-entrada').value); 
    
    // 获取用户选择的期数 (12, 24, 36, 48)
    const mesesSelect = document.getElementById('plazo-meses');
    const meses = mesesSelect ? parseInt(mesesSelect.value) : 24; 
    
    // 1. 计算首付
    const montoEntrada = montoVehiculo * (porcentajeEntrada / 100);
    // 2. 计算期末尾款 (车辆总价值的 30%)
    const cuotaBalloon = montoVehiculo * 0.30;
    // 3. 计算本金
    const capitalFinanciar = montoVehiculo - montoEntrada - cuotaBalloon;
    
    // 4. 动态计算利息 (期数越长利息越高，假设每月1%)
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

    document.getElementById('res-entrada').innerText = `$${montoEntrada.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('res-balloon').innerText = `$${cuotaBalloon.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('res-cuota-usd').innerText = `$${cuotaMensualUSD.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('res-cuota-bs').innerText = `Bs ${cuotaMensualBS.toLocaleString('es-VE', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;

    const textoMeses = document.getElementById('texto-meses-resultado');
    if(textoMeses) textoMeses.innerText = `(Financiado a ${meses} meses)`;

    document.getElementById('btn-pagar-entrada').style.display = 'block';
};

window.pagarEntradaDirecto = function() {
    if (!calculoActual) return;
    const montoRequerido = calculoActual.montoEntrada;

    if (appState.saldoUSD < montoRequerido) {
        ons.notification.confirm({
            message: `Tu saldo actual ($${appState.saldoUSD.toFixed(2)}) es insuficiente para pagar la entrada de $${montoRequerido.toLocaleString()}.<br><br>¿Deseas ir a fondear tu cartera?`,
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
        message: `Se debitarán <b>$${montoRequerido.toLocaleString()}</b> de tu cartera digital para reservar el vehículo mediante contrato inteligente.`,
        title: 'Confirmar Reserva',
        buttonLabels: ['Cancelar', 'Aprobar Contrato']
    }).then(function(res) {
        if (res === 1) {
            ejecutarEgreso('Contrato Inteligente', 'Pago de Entrada (Vehículo)', montoRequerido);
            setTimeout(() => { document.querySelector('ons-tabbar').setActiveTab(0); }, 2000);
        }
    });
};

// ==========================================
// 8. 初始化与事件监听 (Inicialización)
// ==========================================
document.addEventListener('init', async function(event) {
    if (event.target.id === 'page-inicio') {
        tasaBCV = await obtenerTasaBCV(); 
        document.getElementById('tasa-bcv-display').innerText = tasaBCV.toFixed(2); 
        cargarDatos();
        actualizarInicio();
    }
    
    if (event.target.id === 'page-simulador') {
        renderizarCatalogo();
        const tasaEl = document.getElementById('tasa-bcv-simulador');
        if(tasaEl) tasaEl.innerText = tasaBCV.toFixed(2);
    }
});

// 系统一键重置
window.resetearApp = function() {
    ons.notification.confirm({
        message: '¿Estás seguro de que deseas borrar todo tu historial y volver a $0.00? Esta acción no se puede deshacer.',
        title: 'Advertencia de Sistema',
        buttonLabels: ['Cancelar', 'Sí, borrar todo']
    }).then(function(res) {
        if (res === 1) { 
            localStorage.removeItem('ecosistema_data');
            ons.notification.toast('Datos borrados exitosamente. Reiniciando...', { timeout: 1500 });
            setTimeout(() => { location.reload(); }, 1500);
        }
    });
};