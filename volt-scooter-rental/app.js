// Volt scooter rental demo. Data and payments are simulated in the browser.
const $ = s => document.querySelector(s);
const BASE_URL = '';
const API = {
  nearby: (lat, lng, radius = 2000) => `${BASE_URL}/api/v1/telemetry/nearby?lat=${lat}&lng=${lng}&radiusInMeters=${radius}`,
  location: `${BASE_URL}/api/v1/telemetry/location`,
  rentStart: `${BASE_URL}/api/v1/rent/start`,
  rentStop: `${BASE_URL}/api/v1/rent/stop`,
  rentHistory: (userId) => `${BASE_URL}/api/v1/rent/history?userId=${userId}`
};


let scooters = [];
const state = { user: JSON.parse(localStorage.getItem('voltUser')||'null'), balance: Number(localStorage.getItem('voltBalance')||1200), selected:null, reservation:null, ride:null, rideStarted:0, rideTimer:null, bookingTimer:null, telemetryTimer:null, mapSection:'map' };
let map, scooterLayers = {};
function toast(msg){const el=$('#toast');el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}
function money(n){return Math.round(n).toLocaleString('ru-RU')+' ₽'}
function save(){localStorage.setItem('voltUser',JSON.stringify(state.user));localStorage.setItem('voltBalance',state.balance)}
function updateUser(){
 const block=$('#userBlock'), pill=$('#balancePill');
 if(state.user){block.innerHTML=`<div class="avatar">${(state.user.name||'П')[0].toUpperCase()}</div><div class="user-meta"><b>${state.user.name||'Пользователь'}</b><small>${state.user.phone}</small></div><button class="text-btn" id="logoutBtn">Выйти</button>`;$('#logoutBtn').onclick=()=>{state.user=null;save();updateUser();toast('Вы вышли из аккаунта')};$('#topLogin').textContent=(state.user.name||'П')[0].toUpperCase();pill.innerHTML=`Баланс <b>${money(state.balance)}</b>`}
 else {block.innerHTML=`<div class="avatar">G</div><div class="user-meta"><b>Гость</b><small>Войдите, чтобы начать поездку</small></div><button class="text-btn" id="loginBtn">Войти</button>`;$('#loginBtn').onclick=loginModal;$('#topLogin').textContent='G';pill.innerHTML='Баланс <b>—</b>'}
}
function initMap(){
 map=L.map('map',{zoomControl:false}).setView([50.1145,8.6815],14);
 L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(map);
 // Demo rideable zone (green) and restricted area (red)
 const green=[[50.104,8.664],[50.104,8.701],[50.127,8.701],[50.127,8.664]];
 L.polygon(green,{color:'#55ae72',weight:2,fillColor:'#75cf8b',fillOpacity:.13}).addTo(map).bindTooltip('Разрешенная зона поездок');
 const red=[[50.113,8.678],[50.113,8.686],[50.119,8.686],[50.119,8.678]];
 L.polygon(red,{color:'#df6666',weight:2,fillColor:'#ed7777',fillOpacity:.25}).addTo(map).bindTooltip('Запретная зона — движение заблокировано');
 const parking=[[50.109,8.678],[50.117,8.693],[50.122,8.672]];
 parking.forEach((p,i)=>L.marker(p,{icon:L.divIcon({className:'',html:'<div class="parking-marker">P</div>',iconSize:[25,25],iconAnchor:[12,12]})}).addTo(map).bindTooltip('Разрешенная парковка'));
 async function loadNearbyScooters(lat, lng) {
  try {
   const res = await fetch(API.nearby(lat, lng, 2000));
   if (!res.ok) return;
   const data = await res.json();
   const list = Array.isArray(data) ? data : (data.scooters || []);

   scooters = list.map((item, idx) => {
    // Если бэкенд вернул просто строку/число ID (как сейчас в C# коде)
    if (typeof item === 'string' || typeof item === 'number') {
     return {
      id: String(item),
      lat: lat + (Math.sin(idx + 1) * 0.002),
      lng: lng + (Math.cos(idx + 1) * 0.002),
      battery: 100
     };
    }
    // Если бэкенд вернул объект с координатами
    return {
     id: String(item.id ?? item.scooterId),
     lat: Number(item.lat ?? item.latitude),
     lng: Number(item.lng ?? item.longitude),
     battery: Number(item.battery ?? item.batteryLevel ?? 100)
    };
   });

   if ($('#nearbyCount')) $('#nearbyCount').textContent = scooters.length;
   Object.values(scooterLayers).forEach(l => map.removeLayer(l));
   scooterLayers = {};
   scooters.forEach(s => {
    const marker = L.marker([s.lat, s.lng], {icon:L.divIcon({className:'',html:'<div class="scooter-marker">🛴</div>',iconSize:,iconAnchor:})}).addTo(map);
    marker.on('click', () => selectScooter(s));
    scooterLayers[s.id] = marker;
   });
  } catch (e) { console.error('Ошибка загрузки самокатов:', e); }
 }


 loadNearbyScooters(50.1145, 8.6815);
 map.on('moveend', () => { const c = map.getCenter(); loadNearbyScooters(c.lat, c.lng); });
}
function selectScooter(s){
 state.selected=s;$('#scooterName').textContent='№'+s.id;$('#batteryValue').textContent=s.battery+'%';$('#batteryBar').style.width=s.battery+'%';$('#rangeValue').textContent='≈ '+Math.round(s.battery*.37)+' км';
 $('#scooterCard').classList.remove('hidden');$('#reserveNote').textContent=state.reservation?.id===s.id?'Бронь активна: '+formatRemaining():'Бронь бесплатна и действует 10 минут.';
 $('#reserveBtn').textContent=state.reservation?.id===s.id?'Отменить бронь':'Забронировать';map.panTo([s.lat,s.lng]);
}
function formatRemaining(){if(!state.reservation)return '';let sec=Math.max(0,Math.ceil((state.reservation.until-Date.now())/1000));return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`}
function reserve(){
 if(!state.user)return loginModal('Чтобы забронировать самокат, войдите в аккаунт.');
 if(state.reservation?.id===state.selected.id){clearInterval(state.bookingTimer);state.reservation=null;$('#reserveBtn').textContent='Забронировать';$('#reserveNote').textContent='Бронь отменена.';toast('Бронирование отменено');return}
 clearInterval(state.bookingTimer);state.reservation={id:state.selected.id,until:Date.now()+600000};
 $('#reserveBtn').textContent='Отменить бронь';$('#reserveNote').textContent='Осталось '+formatRemaining()+' · самокат закреплен за вами';toast('Самокат забронирован на 10 минут');
 state.bookingTimer=setInterval(()=>{if(!state.reservation)return; if(Date.now()>=state.reservation.until){clearInterval(state.bookingTimer);state.reservation=null;$('#reserveBtn').textContent='Забронировать';$('#reserveNote').textContent='Время брони истекло.';toast('Бронь истекла')}else $('#reserveNote').textContent='Осталось '+formatRemaining()+' · самокат закреплен за вами'},1000);
}
function activateModal(){if(!state.user)return loginModal('Войдите, чтобы начать поездку.');showModal(`<h2>Активация самоката</h2><p>Введите 6-значный код, указанный на руле самоката №${state.selected.id}.</p><div class="field"><label>КОД САМОКАТА</label><input id="scooterCode" inputmode="numeric" maxlength="6" placeholder="Например, 543123"></div><button class="btn primary" id="checkScooter">Проверить и начать</button><div class="hint">Демо-код для тестирования: 543123</div>`);$('#checkScooter').onclick=()=>{let v=$('#scooterCode').value.trim();if(!/^\d{6}$/.test(v)){toast('Введите 6 цифр');return}if(v!=='543123'){toast('Код не найден. Попробуйте 543123');return}closeModal();startRide()}}
function startRide(){
 if(state.balance<49){toast('Недостаточно средств. Пополните баланс');walletSection();return}
 state.balance-=49;save();updateUser();state.ride={id:state.selected.id};state.rideStarted=Date.now();state.reservation=null;clearInterval(state.bookingTimer);
 $('#scooterCard').classList.add('hidden');$('#rideWidget').classList.remove('hidden');$('#tripPanel').innerHTML='<div class="trip-top"><span class="live-dot"></span><b>Поездка активна</b></div><p>Самокат №'+state.ride.id+' · хорошей дороги!</p>';
 state.rideTimer=setInterval(updateRide,1000);updateRide();toast('Поездка начата! Старт: 49 ₽');
}
function updateRide(){if(!state.ride)return;let sec=Math.floor((Date.now()-state.rideStarted)/1000),mins=Math.floor(sec/60);$('#rideTime').textContent=String(Math.floor(sec/3600)).padStart(2,'0')+':'+String(Math.floor(sec/60)%60).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');$('#rideCost').textContent=money(49+mins*7)}
function finishRide(){
 if(!state.ride)return;showModal(`<h2>Завершить поездку?</h2><p>Убедитесь, что вы находитесь в разрешенной зоне парковки. Завершение поездки будет подтверждено после проверки геозоны.</p><button class="btn primary" id="confirmFinish">Да, завершить</button><button class="btn secondary" id="cancelFinish">Продолжить поездку</button>`);$('#cancelFinish').onclick=closeModal;$('#confirmFinish').onclick=async ()=>{
 try {
  const res = await fetch(API.rentStop, {
   method: 'POST',
   headers: {'Content-Type': 'application/json'},
   body: JSON.stringify({ rentId: state.ride.rentId, scooterId: String(state.ride.id), userId: state.user?.id || 1 })
  });
  if(!res.ok) return toast('Ошибка завершения аренды');
 } catch(e) { return toast('Сервер недоступен'); }

 clearInterval(state.telemetryTimer);
 const sec=Math.floor((Date.now()-state.rideStarted)/1000),cost=49+Math.floor(sec/60)*7;
 const trip={id:state.ride.id,date:new Date().toLocaleString('ru-RU'),duration:sec,cost};
 state.balance-=Math.max(0,cost-49);save();clearInterval(state.rideTimer);state.ride=null;
 $('#rideWidget').classList.add('hidden');$('#tripPanel').innerHTML='<div class="trip-top"><span class="live-dot"></span><b>Поездка завершена</b></div><p>Спасибо, что выбрали Volt!</p>';
 updateUser();showModal(`<div style="text-align:center"><div style="font-size:38px;margin-bottom:10px">✓</div><h2>Поездка завершена</h2><p>Самокат №${trip.id}<br>${trip.date}<br>Время: ${Math.floor(sec/60)} мин ${sec%60} сек</p><div class="section-card" style="text-align:left"><div class="section-row"><span>Старт</span><b>49 ₽</b></div><div class="section-row"><span>Время поездки</span><b>${money(cost-49)}</b></div><div class="section-row"><span>Итого</span><b>${money(cost)}</b></div></div><button class="btn primary" id="receiptClose">Закрыть</button></div>`);$('#receiptClose').onclick=closeModal;toast('Списано '+money(cost));};
}
function showModal(html){$('#modalContent').innerHTML=html;$('#modalBackdrop').classList.remove('hidden')}
function closeModal(){$('#modalBackdrop').classList.add('hidden')}
function loginModal(message='Войдите или зарегистрируйтесь, чтобы пользоваться всеми возможностями Volt.'){showModal(`<h2>Добро пожаловать в Volt</h2><p>${message}</p><div class="field"><label>НОМЕР ТЕЛЕФОНА</label><input id="phone" type="tel" placeholder="+7 900 000-00-00"></div><button class="btn primary" id="sendSms">Получить SMS-код</button><div class="hint">Демо-режим: SMS-код будет показан на следующем шаге.</div>`);$('#sendSms').onclick=()=>{let phone=$('#phone').value.trim();if(phone.length<7){toast('Введите корректный номер');return}showModal(`<h2>Подтверждение номера</h2><p>Мы отправили код на ${phone}. В демо используйте код <b>123456</b>.</p><div class="field"><label>КОД ИЗ SMS</label><input id="smsCode" inputmode="numeric" maxlength="6" placeholder="123456"></div><button class="btn primary" id="verifySms">Подтвердить</button>`);$('#verifySms').onclick=()=>{if($('#smsCode').value!=='123456'){toast('Неверный код');return}state.user={name:'Пользователь',phone};save();updateUser();closeModal();toast('Вы успешно вошли')}}}
function walletSection(){renderSection('wallet','Кошелек и оплата','Управляйте балансом и способами оплаты.',`<div class="section-card"><h3>Ваш баланс</h3><h2>${money(state.balance)}</h2><button class="btn primary" id="topup">Пополнить баланс</button></div><div class="section-card"><h3>Банковские карты</h3><div class="section-row"><span>Visa •••• 4242 <small>(демо)</small></span><b>Основная</b></div><button class="btn secondary" id="addCard">+ Привязать новую карту</button></div>`);$('#topup').onclick=()=>showModal(`<h2>Пополнение баланса</h2><p>Выберите сумму пополнения.</p><div class="field"><label>СУММА, ₽</label><input id="topupAmount" type="number" min="100" value="500"></div><button class="btn primary" id="doTopup">Пополнить</button><div class="hint">Демо: реальные платежи не выполняются.</div>`);$('#doTopup').onclick=()=>{let n=Number($('#topupAmount').value);if(n<100||!Number.isFinite(n)){toast('Минимум 100 ₽');return}state.balance+=n;save();updateUser();closeModal();walletSection();toast('Баланс пополнен на '+money(n))};$('#addCard').onclick=()=>showModal(`<h2>Новая карта</h2><p>Демо-форма привязки карты. Данные не отправляются.</p><div class="field"><label>НОМЕР КАРТЫ</label><input placeholder="0000 0000 0000 0000" maxlength="19"></div><div class="field"><label>СРОК ДЕЙСТВИЯ</label><input placeholder="ММ/ГГ"></div><button class="btn primary" id="saveCard">Сохранить карту</button>`);$('#saveCard').onclick=()=>{closeModal();toast('Демо: карта добавлена')}}
function renderSection(key,title,sub,body){state.mapSection=key;$('#mapWrap').classList.add('hidden');const p=$('#contentPanel');p.classList.remove('hidden');p.innerHTML=`<h2>${title}</h2><div class="sub">${sub}</div>${body}`;document.querySelectorAll('.menu-item').forEach(b=>b.classList.toggle('active',b.dataset.section===key))}
async function historySection(){
 renderSection('history','История поездок','Ваши завершенные поездки.',`<div class="section-card"><p>Загрузка истории...</p></div>`);
 try {
  const res = await fetch(API.rentHistory(state.user?.id || 1));
  const data = await res.json();
  const list = Array.isArray(data) ? data : (data.history || data.items || data.data || []);
  const h = list.map(item => ({
   id: item.scooterId ?? item.id ?? '—',
   date: item.date ?? item.createdAt ?? item.startTime ?? '',
   duration: Number(item.duration ?? item.durationSec ?? 0),
   cost: Number(item.cost ?? item.price ?? item.amount ?? 0)
  }));
  renderSection('history','История поездок','Ваши завершенные поездки.',h.length?`<div class="section-card">${h.map(t=>`<div class="section-row"><span>🛴 №${t.id}<br><small>${t.date} · ${Math.floor(t.duration/60)} мин</small></span><b>${money(t.cost)}</b></div>`).join('')}</div>`:`<div class="section-card"><h3>Пока нет поездок</h3><p>Ваша история появится здесь после первой аренды.</p></div>`);
 } catch(e) {
  renderSection('history','История поездок','Ваши завершенные поездки.',`<div class="section-card"><h3>Ошибка загрузки</h3><p>Не удалось получить историю с сервера.</p></div>`);
 }
}
function supportSection(){renderSection('support','Поддержка','Мы на связи и готовы помочь.',`<div class="section-card"><h3>Нужна помощь?</h3><p>Напишите нам — ответим в ближайшее время.</p><button class="btn primary" id="chatSupport">Написать в чат</button> <button class="btn secondary" id="reportProblem">Сообщить о проблеме</button></div>`);$('#chatSupport').onclick=()=>showModal(`<h2>Чат поддержки</h2><p>Опишите ваш вопрос. Специалист поддержки ответит в этом демо-чате.</p><div class="field"><textarea id="chatText" rows="4" placeholder="Ваше сообщение..."></textarea></div><button class="btn primary" id="sendChat">Отправить сообщение</button>`);$('#sendChat').onclick=()=>{if(!$('#chatText').value.trim()){toast('Напишите сообщение');return}closeModal();toast('Сообщение отправлено в демо-режиме')};$('#reportProblem').onclick=()=>showModal(`<h2>Сообщить о проблеме</h2><p>Опишите проблему и при необходимости приложите фото.</p><div class="field"><label>ТИП ПРОБЛЕМЫ</label><input placeholder="Поломка / неправильная парковка"></div><div class="field"><label>ОПИСАНИЕ</label><textarea rows="3" placeholder="Что произошло?"></textarea></div><div class="field"><label>ФОТО</label><input type="file" accept="image/*"></div><button class="btn primary" id="sendReport">Отправить</button>`);$('#sendReport').onclick=()=>{closeModal();toast('Отчет отправлен (демо)')}}
function passesSection(){renderSection('passes','Тарифы и подписки','Выберите подходящий формат поездок.',`<div class="section-card"><h3>Доступные проездные</h3><div class="section-row"><span><b>День</b><br><small>24 часа · старт бесплатно</small></span><b>299 ₽</b></div><div class="section-row"><span><b>Неделя</b><br><small>7 дней · старт бесплатно</small></span><b>899 ₽</b></div><div class="section-row"><span><b>Месяц</b><br><small>30 дней · старт бесплатно</small></span><b>2 490 ₽</b></div><button class="btn primary" id="buyPass">Купить подписку</button></div><p class="sub">Подписка отключает плату за старт поездки на срок действия проездного.</p>`);$('#buyPass').onclick=()=>{if(!state.user){loginModal();return}showModal(`<h2>Подписка оформлена</h2><p>Демо-покупка: выберите тариф в следующей версии. Сейчас доступна тестовая активация месячного плана.</p><button class="btn primary" id="passOk">Активировать демо</button>`);$('#passOk').onclick=()=>{closeModal();toast('Демо-подписка активирована')}}}
$('#reserveBtn').onclick=reserve;$('#activateBtn').onclick=activateModal;$('#closeScooter').onclick=()=>$('#scooterCard').classList.add('hidden');$('#finishRide').onclick=finishRide;
$('#modalClose').onclick=closeModal;$('#modalBackdrop').onclick=e=>{if(e.target===$('#modalBackdrop'))closeModal()};
$('#openSidebar').onclick=()=>$('#sidebar').classList.add('open');$('#closeSidebar').onclick=()=>$('#sidebar').classList.remove('open');
$('#zoomIn').onclick=()=>map.zoomIn();$('#zoomOut').onclick=()=>map.zoomOut();$('#locate').onclick=()=>{if(!navigator.geolocation){toast('Геолокация недоступна');return}navigator.geolocation.getCurrentPosition(p=>{map.setView([p.coords.latitude,p.coords.longitude],16);L.circleMarker([p.coords.latitude,p.coords.longitude],{radius:7,color:'#fff',weight:3,fillColor:'#4389ef',fillOpacity:1}).addTo(map).bindTooltip('Вы здесь')},()=>toast('Не удалось определить местоположение'))};
$('#loginBtn').onclick=loginModal;$('#topLogin').onclick=()=>state.user?toast('Вы вошли как '+state.user.name):loginModal();
document.querySelectorAll('.menu-item').forEach(b=>b.onclick=()=>{let k=b.dataset.section;$('#sidebar').classList.remove('open');if(k==='map'){state.mapSection='map';$('#contentPanel').classList.add('hidden');$('#mapWrap').classList.remove('hidden');document.querySelectorAll('.menu-item').forEach(x=>x.classList.toggle('active',x===b));setTimeout(()=>map.invalidateSize(),50)}else if(k==='wallet')walletSection();else if(k==='passes')passesSection();else if(k==='history')historySection();else supportSection()});
updateUser();initMap();
