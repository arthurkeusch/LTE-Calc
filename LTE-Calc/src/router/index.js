import {createRouter, createWebHistory} from 'vue-router'
import HomeView from '../views/HomeView.vue'
import HataUplinkView from "@/views/HataUplinkView.vue";
import LteThroughputView from "@/views/LteThroughputView.vue";
import FiveGView from "@/views/FiveGView.vue";

const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes: [
        {
            path: '/',
            name: 'home',
            component: HomeView,
        },
        {
            path: '/lte_throughput',
            name: 'lte_throughput',
            component: LteThroughputView,
        },
        {
            path: '/hata_uplink',
            name: 'hata_uplink',
            component: HataUplinkView,
        },
        {
            path: '/FiveG',
            name: 'FiveG',
            component: FiveGView,
        }
    ],
})

export default router
