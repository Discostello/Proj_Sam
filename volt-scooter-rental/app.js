const $ = s => document.querySelector(s);

// Конфигурация эндпоинтов бэкенда
const API = {
  nearby: (lat, lng, radius = 2000) => `/api/v1/telemetry/nearby?latitude=${lat}&longitude=${lng}&radius=${radius}`,
  location: '/api/v1/telemetry/location',
  rentStart: '/api/v1/rent/start',
  rentStop: '/api/v1/rent/stop',
  rentHistory: (userId) => `/api/v1/rent/history/${userId}`
};

const state = {
  user: JSON.parse(localStorage.getItem('voltUser') || 'null'),
  balance: Number(localStorage.getItem('voltBalance') || 1200),
  selected: null,
  reservation: null,
  ride: null,
  rideStarted: 0,
  rideTimer: null,
  bookingTimer: null,
  telemetryTimer: null,
  mapSection: 'map'
};

let scooters = [];
let map, scooterLayers = {};

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2600);
}

function money(n) {
  return Math.round(n).toLocaleString('ru-RU') + ' ₽';
}

function save() {
  localStorage.setItem('voltUser', JSON.stringify(state.user));
  localStorage.setItem('voltBalance', state.balance);
}

function updateUser() {
  const block = $('#userBlock'), pill = $('#balancePill');
  if (state.user) {
    block.innerHTML = `<div class="avatar">${(state.user.name || 'П').toUpperCase()}</div><div class="user-meta"><b>${state.user.name || 'Пользователь'}</b><small>${state.user.phone}</small></div><button class="text-btn" id="logoutBtn">Выйти</button>`;
    $('#logoutBtn').onclick = () => {
      state.user = null;
      save();
      updateUser();
      toast('Вы вышли из аккаунта');
    };
    $('#topLogin').textContent = (state.user.name || 'П').toUpperCase();
    pill.innerHTML = `Баланс <b>${money(state.balance)}</b>`;
  } else {
    block.innerHTML = `<div class="avatar">G</div><div class="user-meta"><b>Гость</b><small>Войдите, чтобы начать поездку</small></div><button class="text-btn" id="loginBtn">Войти</button>`;
    $('#loginBtn').onclick = loginModal;
    $('#topLogin').textContent = 'G';
    pill.innerHTML = 'Баланс <b>—</b>';
  }
}

// 1. Получение самокатов рядом из Redis (/api/v1/telemetry/nearby)
async function loadNearbyScooters(lat = 55.7512, lng = 37.6184) {
  try {
    const res = await fetch(API.nearby(lat, lng, 2000));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.scooters || data.items || data.data || []);

    scooters = list.map(item => ({
      id: item.id ?? item.scooterId ?? item.code ?? '000',
      lat: Number(item.lat ?? item.latitude),
      lng: Number(item.lng ?? item.lon ?? item.longitude),
      battery: Number(item.battery ?? item.charge ?? item.batteryLevel ?? 100)
    })).filter(s => !Number.isNaN(s.lat) && !Number.isNaN(s.lng));

    const countEl = $('#nearbyCount');
    if (countEl) countEl.textContent = scooters.length;

    Object.values(scooterLayers).forEach(layer => map.removeLayer(layer));
    scooterLayers = {};

    scooters.forEach(s => {
      const marker = L.marker([s.lat, s.lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="scooter-marker">🛴</div>',
          iconSize:,
          iconAnchor:
        })
      }).addTo(map);
      marker.on('click', () => selectScooter(s));
      scooterLayers[s.id] = marker;
    });
  } catch (err) {
    console.error('Ошибка загрузки самокатов:', err);
  }
}

// 2. Отправка телеметрии местоположения (/api/v1/telemetry/location)
async function sendTelemetryLocation(scooterId, lat, lng) {
  try {
    await fetch(API.location, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scooterId: String(scooterId),
        latitude: lat,
        longitude: lng
      })
    });
  } catch (err) {
    console.error('Ошибка отправки телеметрии:', err);
  }
}

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([55.7512, 37.6184], 14);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap'
  }).addTo(map);

  const green = [[55.740, 37.600], [55.740, 37.640], [55.765, 37.640], [55.765, 37.600]];
  L.polygon(green, { color: '#55ae72', weight: 2, fillColor: '#75cf8b', fillOpacity: .13 })
    .addTo(map).bindTooltip('Разрешенная зона поездок');

  const red = [[55.749, 37.614], [55.749, 37.623], [55.755, 37.623], [55.755, 37.614]];
  L.polygon(red, { color: '#df6666', weight: 2, fillColor: '#ed7777', fillOpacity: .25 })
    .addTo(map).bindTooltip('Запретная зона — движение заблокировано');

  const parking = [[55.746, 37.615], [55.753, 37.628], [55.758, 37.609]];
  parking.forEach(p =>
    L.marker(p, {
      icon: L.divIcon({
        className: '',
        html: '<div class="parking-marker">P</div>',
        iconSize:,
        iconAnchor:
      })
    }).addTo(map).bindTooltip('Разрешенная парковка')
  );

  loadNearbyScooters(55.7512, 37.6184);

  map.on('moveend', () => {
    const center = map.getCenter();
    loadNearbyScooters(center.lat, center.lng);
  });
}

function selectScooter(s) {
  state.selected = s;
  $('#scooterName').textContent = '№' + s.id;
  $('#batteryValue').textContent = s.battery + '%';
  $('#batteryBar').style.width = s.battery + '%';
  $('#rangeValue').textContent = '≈ ' + Math.round(s.battery * .37) + ' км';
  $('#scooterCard').classList.remove('hidden');
  $('#reserveNote').textContent = state.reservation?.id === s.id
    ? 'Бронь активна: ' + formatRemaining()
    : 'Бронь бесплатна и действует 10 минут.';
  $('#reserveBtn').textContent = state.reservation?.id === s.id ? 'Отменить бронь' : 'Забронировать';
  map.panTo([s.lat, s.lng]);
}

function formatRemaining() {
  if (!state.reservation) return '';
  let sec = Math.max(0, Math.ceil((state.reservation.until - Date.now()) / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function reserve() {
  if (!state.user) return loginModal('Чтобы забронировать самокат, войдите в аккаунт.');
  if (state.reservation?.id === state.selected.id) {
    clearInterval(state.bookingTimer);
    state.reservation = null;
    $('#reserveBtn').textContent = 'Забронировать';
    $('#reserveNote').textContent = 'Бронь отменена.';
    toast('Бронирование отменено');
    return;
  }
  clearInterval(state.bookingTimer);
  state.reservation = { id: state.selected.id, until: Date.now() + 600000 };
  $('#reserveBtn').textContent = 'Отменить бронь';
  $('#reserveNote').textContent = 'Осталось ' + formatRemaining() + ' · самокат закреплен за вами';
  toast('Самокат забронирован на 10 минут');
  state.bookingTimer = setInterval(() => {
    if (!state.reservation) return;
    if (Date.now() >= state.reservation.until) {
      clearInterval(state.bookingTimer);
      state.reservation = null;
      $('#reserveBtn').textContent = 'Забронировать';
      $('#reserveNote').textContent = 'Время брони истекло.';
      toast('Бронь истекла');
    } else {
      $('#reserveNote').textContent = 'Осталось ' + formatRemaining() + ' · самокат закреплен за вами';
    }
  }, 1000);
}

function activateModal() {
  if (!state.user) return loginModal('Войдите, чтобы начать поездку.');
  showModal(`<h2>Активация самоката</h2><p>Введите 6-значный код, указанный на руле самоката №${state.selected.id}.</p><div class="field"><label>КОД САМОКАТА</label><input id="scooterCode" inputmode="numeric" maxlength="6" placeholder="Например, 543123"></div><button class="btn primary" id="checkScooter">Проверить и начать</button><div class="hint">Демо-код для тестирования: 543123</div>`);
  $('#checkScooter').onclick = () => {
    let v = $('#scooterCode').value.trim();
    if (!/^\d{6}$/.test(v)) {
      toast('Введите 6 цифр');
      return;
    }
    if (v !== '543123') {
      toast('Код не найден. Попробуйте 543123');
      return;
    }
    closeModal();
    startRide();
  };
}

// 3. Старт аренды через бэкенд (POST /api/v1/rent/start)
async function startRide() {
  if (state.balance < 49) {
    toast('Недостаточно средств. Пополните баланс');
    walletSection();
    return;
  }

  try {
    const res = await fetch(API.rentStart, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: state.user?.id || 1,
        scooterId: String(state.selected.id)
      })
    });

    if (!res.ok) {
      toast('Ошибка старта аренды на сервере');
      return;
    }

    const rentData = await res.json().catch(() => ({}));

    state.balance -= 49;
    save();
    updateUser();
    state.ride = {
      id: state.selected.id,
      rentId: rentData.rentId ?? rentData.id ?? null
    };
    state.rideStarted = Date.now();
    state.reservation = null;
    clearInterval(state.bookingTimer);

    $('#scooterCard').classList.add('hidden');
    $('#rideWidget').classList.remove('hidden');
    $('#tripPanel').innerHTML = '<div class="trip-top"><span class="live-dot"></span><b>Поездка активна</b></div><p>Самокат №' + state.ride.id + ' · хорошей дороги!</p>';

    state.rideTimer = setInterval(updateRide, 1000);
    updateRide();

    // Отправляем геопозицию во время поездки каждые 10 секунд
    state.telemetryTimer = setInterval(() => {
      if (!state.ride) return;
      const center = map.getCenter();
      sendTelemetryLocation(state.ride.id, center.lat, center.lng);
    }, 10000);

    toast('Поездка начата! Старт: 49 ₽');
  } catch (err) {
    console.error('Ошибка старта поездки:', err);
    toast('Не удалось связаться с сервером');
  }
}

function updateRide() {
  if (!state.ride) return;
  let sec = Math.floor((Date.now() - state.rideStarted) / 1000),
      mins = Math.floor(sec / 60);
  $('#rideTime').textContent = String(Math.floor(sec / 3600)).padStart(2, '0') + ':' + String(Math.floor(sec / 60) % 60).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
  $('#rideCost').textContent = money(49 + mins * 7);
}

