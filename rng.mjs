/** ソフトリセットした時刻から初期シードを計算 */
export function initialSeed(minutes, seconds){
	return (minutes & 0xF) << 8 | seconds;
}

//乱数生成器
const CYCLE_LEN = 0x1000;	//周期は2の12乗
const SEED_MASK = 0xFFF;
const CYCLE = new Uint16Array(CYCLE_LEN);
for(let i=0, x=0; i < CYCLE_LEN; i++, x = x * 61 + 1401 & SEED_MASK){	//乱数は線形合同法で、生成式は X[n+1] = (61 × X[n] + 1401) mod 2^12
	CYCLE[i] = x;
}
/** 指定した位置の乱数値を取得 */
export function rngAt(i){
	return CYCLE[i & SEED_MASK];
}
/** 乱数値を基に、指定した最大値未満の整数を取得 */
export function randi(seed, max){
	return seed * max >> 12;
}
/** 指定した位置の乱数値を基に、指定した最大値未満の整数を取得 */
export function randiAt(i, max){
	return randi(rngAt(i), max);
}

/** 値から位置を逆算 */
export function rngIdxOf(s){
	let r = 0, a = 61, b = 1401, k = 1;
	while(k < 0x1000){
		if(s & 1){
			s = a * s + b;
			r -= k;
		}
		b = (a + 1) * b >>> 1;
		a = a * a & 0xFFF;
		s >>>= 1;
		k <<= 1;
	}
	return r & 0xFFF;
}

/** カービィの着地や衝突による星の向きの乱数 */
export const Star = {
	NAMES: ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'],
	at(i){
		return randiAt(i, 9) & 7;	//各向きの確率は均等ではなく、上が9分の2の確率
	},
}

/** コルクボードの曲から乱数を予測 */
export const Corkboard = {
	NAMES: ['裏コルクボード', 'コルクボード'],
	at(i){
		return randiAt(i, 2);
	},
	/**
	 * コルクボードの曲のパターンに対応する乱数を検索
	 * @param {Array} pattern 1:裏コルクボード、0:コルクボード、-1:ワイルドカード
	 * @returns {Array} 乱数の位置の配列
	 */
	search(pattern){
		const rslt = [];
		for(let i = 0; i < CYCLE_LEN; i++){
			if(pattern.every((x, advances) => -1 === x || this.at(i + advances * 2) === x)){	//タイトル画面とコルクボードの往復で乱数が2進む
				rslt.push({i: i - 2, current: i - 2 + pattern.length * 2});
			}
		}
		return rslt;
	},
}

/** ファッティホエール */
export const FattyWhale = {
	rollsAt(i){
		return 0b01001101 >> (rngAt(i - 3) & 4) + randiAt(i, 4) & 1;
	},
}

/** ヘビーロブスター戦で星の向きから乱数を予測し、乱数をいくつ手動で進めれば目的の乱数を引けるか計算 */
export const HeavyLobster = {
	//歩くか走るか
	walksAt(i){
		return randiAt(i, 4) === 0;
	},
	dashesAt(i){
		return !this.walksAt(i);
	},

	//飛ぶか滑走するか
	jumpsAt(i){
		return randiAt(i, 4) === 0;
	},
	glidesAt(i){
		return !this.jumpsAt(i);
	},

	/**
	 * 星の向きから乱数を推測
	 * @param {Array} pattern 0～7:星の向き, -1:ワイルドカード
	 * @param {Array} additions 各タイミングでの乱数の想定とのズレの配列
	 */
	search(pattern, additions = [], { preFightAdvancesMax, postDashAdvancesMax, postWalkAdvancesMax, } = {}, start = 0, len = CYCLE_LEN){
		//0～4:星の向き、5:走るか、6:走った後、7:歩いた後
		/*
			乱数タイマーごとの乱数位置のパターン
			[0, 66, 129, 160, 181, 557, 586, 600],
			[0, 66, 129, 160, 181, 557, 586, 600],
			[0, 66, 129, 160, 181, 557, 584, 600],
			[0, 66, 129, 160, 181, 557, 584, 600],
			[0, 66, 129, 160, 181, 555, 584, 598],
			[0, 66, 127, 160, 179, 555, 584, 598],
			[0, 66, 127, 160, 179, 555, 584, 598],
			[0, 64, 127, 160, 179, 555, 584, 598],
		*/
		let addition = 0;
		const offsets = [0, 64, 127, 160, 179, 555, 584, 598].map((v, i) => {
			addition += additions[i] ?? 0;
			return v + addition;
		});
		//乱数パターンごとに確率を記録
		const candidates = [];
		const push = (chance, a, n = 0) => {
			candidates.push({
				dashOrWalkIdx: (start + a + offsets[5] + n) & SEED_MASK,
				afterDashIdx: (start + a + offsets[6]) & SEED_MASK,
				afterWalkIdx: (start + a + offsets[7] + n) & SEED_MASK,
				chance: chance
			});
		}
		const match = (i, a) => pattern[i] === -1 || pattern[i] === Star.at(start + a + offsets[i]);
		for (let a = 0; a < len; a++) {
			if (match(0, a) && match(3, a)) { //0と3は全パターン共通
				const b = match(1, a + 2);
				if (match(2, a) && match(4, a)) { //2と4は同じ分布
					if (match(1, a)) {
						push(1, a);
					}
					if (b) {
						push(2, a);
					}
				}
				if (b && match(2, a + 2) && match(4, a + 2)) {
					push(2, a + 2);
					push(2, a, 2);
					push(1, a);
				}
			}
		}

		//乱数を進める最適な量を探す
		const preFight = {
			advances: 0,
			postDash: {
				advances: 0,
				jumpChance: 0,
				glideChance: 0,
			},
			postWalk: {
				advances: 0,
				jumpChance: 0,
				glideChance: 0,
			},
		};

		for (let preFightAdvances = 0; preFightAdvances <= preFightAdvancesMax; preFightAdvances++) {
			//走った場合に乱数を進める最適な量を探す
			const postDash = {
				advances: 0,
				jumpChance: 0,
				glideChance: 0,
			}
			for (let postDashAdvances = 0; postDashAdvances <= postDashAdvancesMax; postDashAdvances++) {
				//走った場合の飛ぶ確率と滑る確率を計算
				let jumpChance = 0;
				let glideChance = 0;
				for (const x of candidates) {
					if (this.dashesAt(x.dashOrWalkIdx + preFightAdvances)) {
						if (this.jumpsAt(x.afterDashIdx + preFightAdvances + postDashAdvances)) {
							jumpChance += x.chance;
						} else {
							glideChance += x.chance;
						}
					}
				}
				//より飛ぶ確率が高ければ更新
				if (jumpChance > postDash.jumpChance) {
					postDash.advances = postDashAdvances;
					postDash.jumpChance = jumpChance;
					postDash.glideChance = glideChance;
				}
			}

			//歩いた場合に乱数を進める最適な量を探す
			const postWalk = {
				advances: 0,
				jumpChance: 0,
				glideChance: 0,
			};
			for (let postWalkAdvances = 0; postWalkAdvances <= postWalkAdvancesMax; postWalkAdvances++) {
				//歩いた場合の飛ぶ確率と滑る確率を計算
				let jumpChance = 0;
				let glideChance = 0;
				for (const x of candidates) {
					if (this.walksAt(x.dashOrWalkIdx + preFightAdvances)) {
						if (this.jumpsAt(x.afterWalkIdx + preFightAdvances + postWalkAdvances)) {
							jumpChance += x.chance;
						} else {
							glideChance += x.chance;
						}
					}
				}
				//より飛ぶ確率が高ければ更新
				if (jumpChance > postWalk.jumpChance) {
					postWalk.advances = postWalkAdvances;
					postWalk.jumpChance = jumpChance;
					postWalk.glideChance = glideChance;
				}
			}

			//更新
			if (0 < (
				(postDash.jumpChance + postWalk.jumpChance) - (preFight.postDash.jumpChance + preFight.postWalk.jumpChance) ||
				postDash.jumpChance - preFight.postDash.jumpChance ||
				postWalk.jumpChance - preFight.postWalk.jumpChance ||
				postDash.glideChance - preFight.postDash.glideChance ||
				preFight.postDash.advances - postDash.advances ||
				preFight.postWalk.advances - postWalk.advances
			)) {
				preFight.advances = preFightAdvances;
				preFight.postDash = postDash;
				preFight.postWalk = postWalk;
			}
		}

		return preFight;
	},
}

/** ボスの並び順 */
function bossOrder(idx, timer, timerMask, length){
	timer &= timerMask;
	const order = Uint8Array.from({length}, (_, i) => (timer + i) % length);
	for(let i = 0; i < length; i++){
		const r = randiAt(++idx, length);
		[order[i], order[r]] = [order[r], order[i]];
	}
	return order;
}
/** ボスの並び順を予測 */
function searchBossOrder(candidates, firstBoss, timerMask, length){
	const rslt = [];
	for(const idx of candidates){
		//timer=0での一戦目との差からtimerを逆算
		const order = bossOrder(idx, 0, 0, length);
		const timer = (firstBoss - order[0] + length) % length;
		if(timer > timerMask) continue;
		rslt.push(bossOrder(idx, timer, timerMask, length));
	}
	return rslt;
}
/** 格闘王への道 */
export const Arena = {
	//ボス名
	NAMES: [
		"ワドルディ",
		"中ボスオールスターズ2",
		"中ボスオールスターズ1",
		"バトルウィンドウズ",
		"2連主砲",
		"魔人ワムバムロック",
		"デデデ大王",
		"ダイナブレイド",
		"ファッティホエール",
		"ガメレオアーム",
		"ヘビーロブスター",
		"クラッコ",
		"ロロロ&ラララ",
		"メタナイト",
		"ギャラクティック・ノヴァ",
		"リアクター",
		"ツインウッズ",
		"ウィスピーウッズ",
		"マルク",
	],
	//ボスの並び順
	SHUFFLE_LEN: 18,
	TIMER_MASK: 0xF,
	bossOrder(idx, timer){
		return bossOrder(idx, timer, this.TIMER_MASK, this.SHUFFLE_LEN);
	},
	searchBossOrder(candidates, timer){
		return searchBossOrder(candidates, timer, this.TIMER_MASK, this.SHUFFLE_LEN);
	},
}
/** 真・格闘王への道 */
export const TrueArena = {
	//ボス名
	NAMES: [
		"真・中ボスオールスターズ",
		"飛行砲台カブーラー",
		"クラッコJr.リベンジ",
		"クラッコリベンジ",
		"ロロロ&ラララリベンジ",
		"ウイスピーウッズリベンジ",
		"マスクドデデデ",
		"ワムバムジュエル",
		"ギャラクティックナイト",
		"マルクソウル",
	],
	//ボスの並び順
	SHUFFLE_LEN: 6,
	TIMER_MASK: 0x3,
	bossOrder(idx, timer){
		return bossOrder(idx, timer, this.TIMER_MASK, this.SHUFFLE_LEN);
	},
	searchBossOrder(candidates, firstBoss){
		return searchBossOrder(candidates, firstBoss, this.TIMER_MASK, this.SHUFFLE_LEN);
	},
}
