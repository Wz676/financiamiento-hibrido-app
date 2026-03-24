// 1. 系统核心状态
let appState = {
    saldoUSD: 0.00, // 底层永远以 USD 记账
    transacciones: []
};

let tasaBCV = 36.35; // 模拟当天官方汇率
let monedaVista = 'USD'; // 当前界面的显示货币状态 ('USD' 或 'BS')

// 【重要】粘贴你的 Google Apps Script URL
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbwf5gIZ_XQ19y_4jkSrHdtQMzbeFX0qECT62Of5BK0mLmDxsHj2mxAH6lvhSBiR3eZv/exec";

// 2. 获取真实的 BCV 实时汇率 (Conexión a API real con Fallback)
async function obtenerTasaBCV() {
    try {
        // 请求委内瑞拉社区常用的开源汇率 API
        const response = await fetch('https://pydolarvenezuela-api.vercel.app/api/v1/dollar/page?page=bcv');
        
        if (!response.ok) throw new Error('Error en la red');
        
        const data = await response.json();
        const tasaReal = data.monitors.usd.price; // 获取返回的 USD 价格
        
        console.log("Tasa BCV obtenida en tiempo real:", tasaReal);
        return parseFloat(tasaReal);
        
    } catch (error) {
        // 容灾机制：如果没网或者 API 挂了，使用这个备用数字，保证系统不崩溃
        console.warn("API del BCV no disponible. Usando tasa de respaldo.", error);
        ons.notification.toast('Usando tasa BCV de respaldo por fallo de conexión', { timeout: 3000 });
        return 475; // 你可以手动修改这里的备用汇率
    }
}

// 3. 智能数据加载与版本兼容 (Migración de datos)
function cargarDatos() {
    const datos = localStorage.getItem('ecosistema_data');
    if (datos) {
        let datosGuardados = JSON.parse(datos);
        
        // 检查是不是旧版本的数据（如果有 'saldo' 但没有 'saldoUSD'）
        if (datosGuardados.saldo !== undefined && datosGuardados.saldoUSD === undefined) {
            appState.saldoUSD = datosGuardados.saldo; // 把旧资产转移到新变量
            appState.transacciones = datosGuardados.transacciones || [];
            console.log("Migración de datos completada.");
        } else {
            appState = datosGuardados; // 正常加载新版数据
        }
    }
}

function guardarDatos() {
    localStorage.setItem('ecosistema_data', JSON.stringify(appState));
}

// 4. 一键切换货币显示
window.toggleMoneda = function() {
    monedaVista = monedaVista === 'USD' ? 'BS' : 'USD';
    document.getElementById('texto-moneda').innerText = monedaVista === 'USD' ? 'Bolívares' : 'Dólares';
    actualizarInicio();
};

// 5. 更新 UI (智能折算双币)
function actualizarInicio() {
    const saldoEl = document.getElementById('saldo-actual');
    if(saldoEl) {
        // 如果选择看 Bs，就把底层的 USD 乘以汇率
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
            
            // 列表始终显示交易时的基础价值 (USD)，但标注原支付方式
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

// 6. 区分本币/外币的充值菜单
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

// 7. 智能输入框 (带即时汇率折算提示)
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
            
            // 如果用户输入的是玻利瓦尔，弹出折算确认框
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
                // 如果直接输入美元，无需折算直接入账
                ejecutarTransaccion(metodoObj.nombre, montoOriginal);
            }
        }
    });
}

// 8. 执行交易并保存
function ejecutarTransaccion(metodoNombre, montoUSD) {
    ons.notification.toast(`Procesando pago vía ${metodoNombre}...`, { timeout: 1500 });
    
    setTimeout(() => {
        const nuevaTx = {
            id: 'TXN-' + Math.floor(Math.random() * 1000000),
            tipo: 'ingreso',
            metodo: metodoNombre,
            concepto: 'Fondeo de Billetera',
            montoUSD: montoUSD, // 永远保存USD
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
    
    // 为了表格更好看，我们将交易数据压平发送
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

// 9. 初始化 (加载汇率、恢复数据)
document.addEventListener('init', async function(event) {
    if (event.target.id === 'page-inicio') {
        tasaBCV = await obtenerTasaBCV(); // 等待汇率加载
        document.getElementById('tasa-bcv-display').innerText = tasaBCV.toFixed(2); // 显示在界面上
        
        cargarDatos();
        actualizarInicio();
    }
});

// 10. 系统级一键重置 (Borrar Datos de Usuario)
window.resetearApp = function() {
    ons.notification.confirm({
        message: '¿Estás seguro de que deseas borrar todo tu historial y volver a $0.00? Esta acción no se puede deshacer.',
        title: 'Advertencia de Sistema',
        buttonLabels: ['Cancelar', 'Sí, borrar todo']
    }).then(function(res) {
        if (res === 1) { // 如果用户点击了“Sí, borrar todo”
            // 彻底清除浏览器的本地存储缓存
            localStorage.removeItem('ecosistema_data');
            
            // 弹出提示框
            ons.notification.toast('Datos borrados exitosamente. Reiniciando...', { timeout: 1500 });
            
            // 1.5秒后强制刷新整个网页，让系统回到“出厂设置”
            setTimeout(() => {
                location.reload(); 
            }, 1500);
        }
    });
};

// ==========================================
// MÓDULOS DE EGRESO (TRANSFERIR Y PAGAR)
// ==========================================

// 1. 模块：模拟转账 (Transferir)
window.simularTransferencia = function() {
    // 拦截：如果没有钱，直接拒绝
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
        if (destinatario) {
            pedirMontoEgreso('Transferencia a', destinatario);
        }
    });
};

// 2. 模块：模拟支付 (Pagar)
window.simularPago = function() {
    if (appState.saldoUSD <= 0) {
        ons.notification.alert('No tienes saldo suficiente para realizar pagos.');
        return;
    }

    // 弹出一个精美的底部菜单让用户选择支付场景
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

// 3. 支出核心逻辑：询问金额并检查余额
function pedirMontoEgreso(tipoOperacion, detalle) {
    ons.notification.prompt({
        message: `Ingrese el monto en <b>Dólares (USD)</b> para:<br><br><span style="color:gray;">${detalle}</span>`,
        title: 'Monto a debitar',
        buttonLabel: 'Confirmar',
        cancelable: true
    }).then(function(input) {
        const montoOperacion = parseFloat(input);
        
        if (montoOperacion > 0) {
            // 【风控检查】如果输入的金额大于账户余额，拒绝交易！
            if (montoOperacion > appState.saldoUSD) {
                ons.notification.alert(`<b>Fondos insuficientes.</b><br>Tu saldo actual es de $${appState.saldoUSD.toFixed(2)} USD.`);
            } else {
                ejecutarEgreso(tipoOperacion, detalle, montoOperacion);
            }
        }
    });
}

// 4. 执行扣款并同步到 Google Sheets
function ejecutarEgreso(tipoOperacion, detalle, montoUSD) {
    ons.notification.toast(`Procesando transacción...`, { timeout: 1500 });
    
    setTimeout(() => {
        const nuevaTx = {
            id: 'TXN-' + Math.floor(Math.random() * 1000000),
            tipo: 'egreso', // 【关键】标记为 egreso (支出)，UI 会自动把它变成红色负数
            metodo: tipoOperacion,
            concepto: detalle,
            montoUSD: montoUSD,
            fecha: new Date().toLocaleDateString()
        };
        
        // 扣除余额
        appState.saldoUSD -= montoUSD;
        appState.transacciones.push(nuevaTx);
        
        // 保存本地数据、更新界面、发送到云端
        guardarDatos();
        actualizarInicio();
        enviarAGoogleSheets(nuevaTx);
        
        ons.notification.toast('¡Operación exitosa!', { timeout: 2000, animation: 'ascend' });
    }, 1500);
}