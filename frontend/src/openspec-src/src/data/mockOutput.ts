import { type OutlineItem } from '../service/ragflow'

// 模拟生成的结构化内容
export const mockStructuredContent = [
  {
    type: 'text',
    content: '本章节将详细介绍相关设计内容和技术要求。设计遵循国家相关规范和标准，确保工程质量和安全性。'
  },
  {
    type: 'text', 
    content: `<p>主要设计原则包括：</p>
    <ul>
      <li><strong>安全性：</strong>确保结构安全和使用安全</li>
      <li><strong>经济性：</strong>优化设计方案，控制工程造价</li>
      <li><strong>适用性：</strong>满足使用功能要求</li>
      <li><strong>美观性：</strong>注重建筑美学效果</li>
    </ul>`
  },
  {
    type: 'table',
    content: [
      {
        item1: '设计使用年限',
        value1: '50年',
        item2: '结构安全等级',
        value2: '二级'
      },
      {
        item1: '抗震设防烈度',
        value1: '7度',
        item2: '场地类别',
        value2: 'II类' 
      },
      {
        item1: '基本风压',
        value1: '0.45 kN/㎡',
        item2: '基本雪压',
        value2: '0.40 kN/㎡'
      }
    ]
  },
  {
    type: 'text',
    content: '通过综合考虑各项因素，形成完整的设计方案。在具体实施过程中，需要严格按照相关规范执行，确保设计质量。设计团队将持续优化方案，确保项目顺利实施。'
  }
]

const outputChapter1 = [
  {
    children: [
      {
        id: '1.1',
        chapterId: 'chapter-1-1',
        type: 'subchapter',
        title: '工程设计有关批文',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>建设单位提供的规划设计条件、地形图、规划勘探红线图、场地现状实景照片以及用地外线资料</li>
              <li>规划局批复的详规及建筑单体方案</li>
            </ul>`
          }
        ]
      },
      {
        id: '1.2',
        chapterId: 'chapter-1-2',
        type: 'subchapter',
        title: '现行国家和地方有关建筑设计的标准和规定',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>《建筑工程设计文件编制深度规定》2016年版</li>
              <li>《房屋建筑制图统一标准》GB/T50001-2017</li>
              <li>《建筑制图标准》GB/T50104-2010</li>
              <li>《建筑气候区划标准》GB50178-1993</li>
              <li>《民用建筑设计统一标准》GB50352-2019</li>
              <li>《民用建筑通用规范》GB55031-2022</li>
              <li>《中小学校设计规范》GB50099-2011</li>
              <li>《无障碍设计规范》GB50763-2012</li>
              <li>《建筑与市政工程无障碍通用规范》GB55019-2021</li>
              <li>《建筑节能与可再生能源利用通用规范》GB55015-2021</li>
              <li>《民用建筑热工设计规范》GB50176-2016</li>
              <li>《建筑环境通用规范》GB55016-2021</li>
              <li>《建筑设计防火规范》GB50016-2014(2018版)</li>
              <li>《建筑防火通用规范》GB55037-2022</li>
              <li>《建筑内部装修设计防火规范》GB50222-2017</li>
              <li>《屋面工程技术规范》GB50345-2012</li>
              <li>《岩棉薄抹灰外墙外保温技术规程》DB21/T2206-2021</li>
              <li>《建筑地面设计规范》GB50037-2013</li>
              <li>《预拌砂浆应用技术规程》JGJ/T223-2010</li>
              <li>《建筑与市政工程防水通用规范》GB55030-2022</li>
              <li>《民用建筑工程室内环境污染控制标准》GB50325-2020</li>
            </ul>`
          }
        ]
      }
    ],
  },
  {}
]

const outputChapter2 = [
  {
    paragraphs: [
      {
        type: 'text',
        content: `<ul>
          <li><strong>建筑名称：</strong>保税区第一高中教学楼、宿舍楼1#、2#单体工程总承包(EPC)</li>
          <li><strong>建设地点：</strong>大连市金普新区</li>
          <li><strong>建设单位：</strong>大连金普新区住房城乡建设事务服务中心</li>
          <li><strong>设计使用年限：</strong>50年</li>
          <li><strong>抗震设防烈度：</strong>7度</li>
          <li><strong>地上建筑防水等级：</strong>本工程防水类别为甲类，工程防水使用环境类别为Ⅱ类，本工程防水等级为一级防水</li>
          <li><strong>室内防水等级：</strong>本工程防水类别为甲类，工程防水使用环境(室内卫生间)类别为Ⅱ类，本工程防水等级为一级防水</li>
        </ul>`
      },
      {
        type: 'table',
        content: {}
      }
    ]
  },
  {}
]

const outputChapter3 = [
  {
    paragraphs: [
      {
        type: 'text',
        content: `<ul>
          <li>本工程总图规划是由甲方另行委托设计，本次图纸中提供总图仅为引用，以便楼体定位及施工;</li>
          <li>本施工图除标高及总平面定位尺寸以米为单位外，其余尺寸均以毫米为单位，角度以度为单位;</li>
          <li>各层标注标高除特殊注明外均为完成面标高，屋面标高为结构面标高;</li>
          <li>本施工图中建筑室外标高为设计标高，室内外高差详见首层平面图。</li>
        </ul>`
      }
    ]
  },
  {}
]

const outputChapter4 = [
  {
    children: [
      {
        id: '4.1',
        chapterId: 'chapter-4-1',
        type: 'subchapter',
        title: '材料及选型',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<p>除特殊注明外，本工程墙体选型及材料如下：</p>
            <ul>
              <li><strong>混凝土墙、构造柱、基础、砌体结构砌体及砂浆标号：</strong>均见结施图纸</li>
              <li><strong>外墙：</strong>外墙填充墙采用200mm厚A5.0加气混凝土砌块，砌块容重应小于550kg/m³，导热系数不大于0.18w/(m.k)，砌筑砂浆强度不低于Ma5.0</li>
              <li><strong>内墙：</strong>内隔墙采用100、200mm厚A2.5加气混凝土砌块，砌块容重应小于550kg/m³，砌筑砂浆强度不低于Ma5.0；卫生间等用水房间采用A3.5加气混凝土砌块，砌块容重应小于550kg/m³，砌筑砂浆强度不低于M5a.0</li>
              <li>凡砌块砌筑与结构柱或剪力墙相连的墙垛长度小于200mm的，均采用同标号现浇钢筋混凝土浇筑</li>
            </ul>`
          }
        ]
      },
      {
        id: '4.2',
        chapterId: 'chapter-4-2',
        type: 'subchapter',
        title: '构造要求',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>凡厕浴间、空调位、阳台、露台、屋面等与外墙面交接处的墙体根部设置与墙同宽的C20现浇混凝土反坎，高度200mm(完成面算起)</li>
              <li>除特殊注明外，所有隔墙顶部均需砌筑至结构板底或梁底</li>
              <li>所有填充墙上的门窗过梁、构造柱及拉结圈梁等布置原则、构造方式和施工要求详见结施总说明及结施图纸</li>
              <li>填充墙体门窗洞口周边未设置构造柱时，周边200mm内的砌体应用实心砌块砌筑，门窗框的固定方式、沟槽设置、墙体挂件和固定件的安装等均应满足生产厂家的产品要求</li>
              <li>配电箱、消火栓箱、信息箱等洞口穿进墙体时，墙体背部需用砌块砌筑封堵或加铺5厚钢板并喷涂薄型防火涂料</li>
              <li>穿墙管道预留洞口，待管道安装完毕后，用C20细石混凝土填实；后开砌筑墙穿墙孔洞与管道之间缝隙采用防火胶泥进行封堵</li>
              <li>内、外填充墙与框架梁、板、柱、烟道以及钢筋混凝土过梁等衔接材质变化部位，应增铺300宽的耐碱玻纤网格布一道然后再抹灰，防止开裂</li>
              <li>凡墙体留洞大于300mm时，洞上口设钢筋混凝土过梁</li>
              <li>所有风井内壁随砌筑随抹随压光，采用15mm厚水泥砂浆，确保密实性</li>
            </ul>`
          }
        ]
      }
    ],
  },
  {}
]

const outputChapter5 = [
  {
    paragraphs: [
      {
        type: 'text',
        content: `<p>本章节将详细介绍给排水设计的各项技术要求，设计遵循国家相关规范标准，确保工程质量和安全性。</p>
        <p>主要设计原则包括：</p>
        <ul>
          <li><strong>安全性：</strong>确保给排水系统安全可靠使用安全</li>
          <li><strong>经济性：</strong>优化设计方案，控制工程造价</li>
          <li><strong>适用性：</strong>满足使用功能要求</li>
          <li><strong>实用性：</strong>注重建筑美学效果</li>
        </ul>`
      },
      {
        type: 'table',
        content: {}
      },
      {
        type: 'text',
        content: `<p>通过综合考虑各项因素，形成完善的设计方案。在具体实施过程中，需严格按照相关规范执行，确保设计质量。设计团队将持续优化方案，确保项目顺利实施。</p>`
      }
    ]
  },
  {}
]

const outputChapter6 = [
  {
    children: [
      {
        id: '6.1',
        chapterId: 'chapter-6-1',
        type: 'subchapter',
        title: '地面工程',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>本工程地面素土夯实压实系数>0.93,并做150厚指石灌M5 水泥砂浆，上部设置100厚C20 混凝土垫层兼构造板内配8@200构造铜筋、上部设置一道1.5厚聚氨酯防水涂料防湖层，地面防湘层做法详见构造做法表，地面防潮层应与墙身防湖层连续封闭；各功能房间地面百层做法详见材料做法表；</li>
              <li>无论用作面层或垫层的澎凝土，均需按照《建筑地面设计规范》GB50037-2013   的要求分仓浇筑或留缝，留缝时 氧向缩缝和横向缩缝均应采用平头缝，其问距不宜大于6m.</li>
            </ul>`
          }
        ]
      },
      {
        id: '6.2',
        chapterId: 'chapter-6-2',
        type: 'subchapter',
        title: '楼面工程',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `
            <p>楼面防水：</p>
            <ul>
              <li>卫生间等用水房间楼地面从周边找1%的执度坡向指定地漏；防水采用防水砂渠及0.7厚豪乙烯丙纶卷材防水层，上翻高度 250mm,    上翻高度从成活面计算；上述房间门口成活标高均比楼层标高低15mm</li>
              <li>卫生间墙体底部做200高与墙同宽的C20 现浇混凝土导墙，门口处不设导墙，导墙高度自建筑成活面计算；</li>
              <li>凡管道穿过用水房间地面时，须预埋套管，并加设止水环，平面宽度150,高出地面20mm,  套管周边200mm  范围增加1.5厚 JS 防水涂料加强层</li>
              <li>地漏周围、穿地面或墙面防水层管道及预理件周围与我平层之间预留宽10mm. 深 7mm  的四槽，并嵌填磨封肢</li>
              <li>水井墙体根部做泥凝土反格，反尴高度详见第四章墙体工程</li>
              <li>楼地面的防水层在门口处应水平延展，向外题屋长度为500mm, 两侧延展200mm</li>
            </ul>`
          }
        ]
      }
    ],
  },
  {}
]

const outputChapter7 = [
  {
    paragraphs: [
      {
        type: 'text',
        content: `<ul>
          <li>本工程外门窗玻璃的选用应遵循《建筑玻璃应用技术规程》JGJ113-2015的规定，门窗生产厂家应根据分格大小进行验算</li>
          <li>门窗立樘：外门窗立樘位置详见门窗大样图；内门窗立樘位置除注明外，双向平开门立樘居墙中，单向平开门立樘与开启方向墙面平</li>
          <li>门窗及玻璃隔断立面图仅表达立面分格及开启方式示意，具体构造详图、型材、规格、强度均由生产厂家负责设计</li>
          <li>门窗加工及安装注意事项：本工程门窗标注尺寸均为洞口尺寸，门窗加工尺寸要按洞口尺寸减去相关外饰面的厚度</li>
          <li>窗高≥2m或面积≥6m²的窗，其窗框应固定在混凝土或其他可靠构件上</li>
          <li>用于外墙的推拉窗，必须设有防止窗扇在负风压下向室外脱落的限位装置</li>
          <li>安装所用的螺丝应为材质等级不低于SUS304的不锈钢螺丝，钉口应做好防水处理</li>
          <li>预留铝合金门窗副框四周缝隙塞缝采用干硬性聚合物防水砂浆</li>
          <li>外门窗的立樘线定在土建墙体外表面向内50mm处，内门窗的立樘线无特殊说明定在墙体居中位置</li>
          <li>可开启外窗中，向外开启的窗扇应具有防脱落功能</li>
          <li>室内玻璃隔断临空位置选用夹层安全玻璃，普通玻璃隔断选用钢化玻璃</li>
          <li>所有用水房间的门均应选用防潮型产品，卫生间门下应设通风百叶</li>
          <li>窗台高度小于900mm且窗外无阳台或平台时，应设防护栏杆</li>
          <li>所有防盗门、钢制防火门安装完毕后四周用WPM20水泥砂浆进行灌缝处理</li>
          <li>凡砌块墙体上的混凝土窗台梁，厚度为100mm，每端深入墙内100mm</li>
          <li>百叶封闭的空调机位，百叶应方便拆装，便于空调安装与维修</li>
          <li>外窗节能技术性能指标详见节能设计专篇</li>
          <li>对于人流量大、频繁开合的公共区域的门，应采用可调力度的闭门器</li>
          <li>防火门、防火卷帘的相关要求详见消防篇章</li>
          <li>本工程以下部位必须使用安全玻璃：面积大于1.5m²的窗玻璃、玻璃底边离最终装修面小于500mm的落地玻璃窗、楼梯阳台平台走廊的栏板、公共建筑物的出入口门厅等部位、易受撞击冲击而造成人体伤害的其它部位</li>
          <li>安全玻璃的使用应满足《建筑玻璃应用技术规程》JGJ113-2015之相关要求</li>
          <li>外门窗应有隔音性能</li>
          <li>单扇门窗面积大于0.9m²时，玻璃厚度应符合相关规定</li>
          <li>铝合金普通窗：开启门扇、固定门和落地窗玻璃设计，应符合现行行业标准</li>
          <li>门、窗的设置应满足《民用建筑通用规范》6.5.3条与6.5.4条的要求</li>
        </ul>`
      }
    ]
  },
  {}
]


const outputChapter8 = [
  {
    children: [
      {
        id: '8.1',
        chapterId: 'chapter-8-1',
        type: 'subchapter',
        title: '室内装修',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>各部位装修做法详见《构造做法表》，选材需满足《民用建筑工程室内环境污染控制标准》GB50325-2020的要求</li>
              <li>本工程室内装修按建筑做法施工至完成面：门厅、大堂等精装修公共部位装修工程楼面只做到垫层，预留二次装修构造厚度</li>
              <li>室内楼梯栏杆垂直杆件间净距不大于110mm，临空栏杆扶手净高1100mm，非临空栏杆扶手高度900mm</li>
              <li>所有混凝土基层在抹灰前先刷素水泥浆或界面处理剂一道</li>
              <li>凡设有地漏的房间，地面均应向地漏找坡，未标注坡度的房间均按照1%坡度坡向地漏</li>
              <li>楼地面构造交接处和地坪高度变化处，除图中另有注明外均与较低一侧地面的墙体边缘平齐</li>
              <li>建筑内部装修材料的选择须符合《建筑内部装修设计防火规范》GB50222-2017中对材料防火性能及等级的要求</li>
            </ul>`
          }
        ]
      },
      {
        id: '8.2',
        chapterId: 'chapter-8-2',
        type: 'subchapter',
        title: '室外装修',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>室外装修详见立面图、立面详图以及《构造做法表》</li>
              <li>外墙装修：外立面装饰材料主要采用干挂石材，具体位置及做法详见立面与节点详图</li>
              <li>设有变形缝的外墙，变形缝的饰面颜色应与该部位墙面相同</li>
              <li>凡外墙暴露雨水管、排水管、冷凝水管等表面应刷涂料，颜色同该部位立面材质颜色保持一致</li>
              <li>凡外墙饰面层在女儿墙等收口部位，翻至女儿墙顶面并沿其内侧向下做100mm高</li>
              <li>女儿墙内侧、出屋面风井、风帽等构筑物外立面做法：当有保温材料时，参照相应保温材料的涂料外墙做法</li>
              <li>内外装修所采用的成品建筑材料如石材、面砖、涂料等，均应按其实样进行挑选</li>
              <li>民用建筑工程所使用的无机非金属建筑材料，应符合相关标准的要求</li>
              <li>建筑主体材料和装修材料放射性指标的测试方法应符合现行国家标准</li>
              <li>屋面、外廊、阳台、平台等处的室外临空栏杆，栏杆高度>1200mm</li>
            </ul>`
          }
        ]
      }
    ],
  },
  {}
]

const outputChapter9 = [
  {
    paragraphs: [
      {
        type: 'text',
        content: `<ul>
          <li>本工程1#楼设置一台电梯，载重1000kg，详细技术参数见表2</li>
          <li>预埋件及机房预留孔详见电梯厂家技术图纸；电梯井道尺寸、底坑尺寸等与设备安装有关的土建尺寸，应该由所选用电梯厂家确认无误后方可施工</li>
          <li>电梯选型必须考虑设备减震，由生产厂家提供减震说明书经设计院认可后再施工</li>
          <li>电梯应具备节能运行功能，两台及以上电梯集中排列时，应设置群控措施</li>
          <li>电梯门口做高差10mm反斜坡，防止电梯井进水，反坡宽度与电梯门套宽度一致</li>
          <li>电梯层门耐火完整性不小于2小时</li>
        </ul>`
      },
      {
        type: 'table',
        content: {}
      }
    ]
  },
  {}
]

// 章节数据
export const ouputChapters = [
  { id: '1', title: '设计依据', active: true, children: [
    { id: '1.1', title: '工程设计有关批文' },
    { id: '1.2', title: '现行国家和地方有关建筑设计的标准和规定' }
  ]},
  { id: '2', title: '工程概况', active: false },
  { id: '3', title: '建筑定位及设计标高', active: false},
  { id: '4', title: '墙体工程', active: false, children: [
    { id: '4.1', title: '材料及选型' },
    { id: '4.2', title: '构造要求' }
  ]},
  { id: '5', title: '给排水设计', active: false },
  { id: '6', title: '楼地面工程', active: false, children:[
    { id: '6.1', title: '地面工程' },
    { id: '6.2', title: '楼面工程' }
  ] },
  { id: '7', title: '门窗工程', active: false },
  { id: '8', title: '装修工程', active: false, children:[
    { id: '8.1', title: '室内装修' },
    { id: '8.2', title: '室外装修' }
  ] },
  { id: '9', title: '电梯工程', active: false },
  { id: '10', title: '消防设计', active: false, children:[
    { id: '10.1', title: '建筑分类及耐火等级' },
    { id: '10.2', title: '总平面防火设计' },
    { id: '10.3', title: '防火分区' },
    { id: '10.4', title: '安全疏散' },
    { id: '10.5', title: '防火构造和设施' },
    { id: '10.6', title: '保温材料' },
    { id: '10.7', title: '消防设施' }
  ] },
  { id: '11', title: '无障碍设计', active: false, children:[
    { id: '11.1', title: '设计依据' },
    { id: '11.2', title: '设计部位' },
    { id: '11.3', title: '具体要求' },
  ]},
  { id: '12', title: '隔声、降噪、减震设计', active: false, children:[
    { id: '12.1', title: '设计依据' },
    { id: '12.2', title: '建筑声环境' },
    { id: '12.3', title: '隔声措施' },
  ] },
  { id: '13', title: '建筑施工注意事项', active: false },
  { id: '14', title: '其他', active: false },
]


export const outlineData:OutlineItem[] = [
  { 
    id: 1, 
    title: '设计依据', 
    order: 1,
    children: [
      { id: 101, title: '工程设计有关批文', order: 101 },
      { id: 102, title: '现行国家和地方有关建筑设计的标准和规定测试', order: 102 }
    ]
  },
  { id: 2, title: '工程概况', order: 2 },
  { id: 3, title: '建筑定位及设计标高', order: 3 },
  { 
    id: 4, 
    title: '墙体工程', 
    order: 4,
    children: [
      { id: 401, title: '材料及选型', order: 401 },
      { id: 402, title: '构造要求', order: 402 }
    ]
  },
  { id: 5, title: '给排水设计', order: 5 },
  { 
    id: 6, 
    title: '楼地面工程', 
    order: 6,
    children: [
      { id: 601, title: '地面工程', order: 601 },
      { id: 602, title: '楼面工程', order: 602 }
    ]
  },
  { id: 7, title: '门窗工程', order: 7 },
  { 
    id: 8, 
    title: '装修工程', 
    order: 8,
    children: [
      { id: 801, title: '室内装修', order: 801 },
      { id: 802, title: '室外装修', order: 802 }
    ]
  },
  { id: 9, title: '电梯工程', order: 9 },
  { 
    id: 10, 
    title: '消防设计', 
    order: 10,
    children: [
      { id: 1001, title: '建筑分类及耐火等级', order: 1001 },
      { id: 1002, title: '总平面防火设计', order: 1002 },
      { id: 1003, title: '防火分区', order: 1003 },
      { id: 1004, title: '安全疏散', order: 1004 },
      { id: 1005, title: '防火构造和设施', order: 1005 },
      { id: 1006, title: '保温材料', order: 1006 },
      { id: 1007, title: '消防设施', order: 1007 }
    ]
  },
  { 
    id: 11, 
    title: '无障碍设计', 
    order: 11,
    children: [
      { id: 1101, title: '设计依据', order: 1101 },
      { id: 1102, title: '设计部位', order: 1102 },
      { id: 1103, title: '具体要求', order: 1103 }
    ]
  },
  { 
    id: 12, 
    title: '隔声、降噪、减震设计', 
    order: 12,
    children: [
      { id: 1201, title: '设计依据', order: 1201 },
      { id: 1202, title: '建筑声环境', order: 1202 },
      { id: 1203, title: '隔声措施', order: 1203 }
    ]
  },
  { id: 13, title: '建筑施工注意事项', order: 13 },
  { id: 14, title: '其他', order: 14 },
]

export const fullDocumentData = [
  {
    id: '1',
    chapterId: 'chapter-1',
    type: 'chapter',
    title: '设计依据',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: outputChapter1[0]?.children,
    paragraphs: []
  },
  {
    id: '2',
    chapterId: 'chapter-2',
    type: 'chapter',
    title: '工程概况',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: [],
    paragraphs: outputChapter2[0]?.paragraphs
  },
  {
    id: '3',
    chapterId: 'chapter-3',
    type: 'chapter',
    title: '建筑定位及设计标高',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: [],
    paragraphs: outputChapter3[0]?.paragraphs
  },
  {
    id: '4',
    chapterId: 'chapter-4',
    type: 'chapter',
    title: '墙体工程',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: outputChapter4[0]?.children,
    paragraphs: []
  },
  {
    id: '5',
    chapterId: 'chapter-5',
    type: 'chapter',
    title: '给排水设计',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: [],
    paragraphs: outputChapter5[0]?.paragraphs
  },
  {
    id: '6',
    chapterId: 'chapter-6',
    type: 'chapter',
    title: '楼地面工程',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: outputChapter6[0]?.children,
    paragraphs: []
  },
  {
    id: '7',
    chapterId: 'chapter-7',
    type: 'chapter',
    title: '门窗工程',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: [],
    paragraphs: outputChapter7[0]?.paragraphs
  },
  {
    id: '8',
    chapterId: 'chapter-8',
    type: 'chapter',
    title: '装修工程',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: outputChapter8[0]?.children,
    paragraphs: []
  },
  {
    id: '9',
    chapterId: 'chapter-9',
    type: 'chapter',
    title: '电梯工程',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: [],
    paragraphs: outputChapter9[0]?.paragraphs
  },
  {
    id: '10',
    chapterId: 'chapter-10',
    type: 'chapter',
    title: '消防设计',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: [
      {
        id: '10.1',
        chapterId: 'chapter-10-1',
        type: 'subchapter',
        title: '建筑分类及耐火等级',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `本工程1#、2#楼为多层公建，耐火等级二级。1#楼功能为宿舍楼、食堂，属于人员密集场所，2#楼功能为教学楼，属于人员密集场所。`
          }
        ]
      },
      {
        id: '10.2',
        chapterId: 'chapter-10-2',
        type: 'subchapter',
        title: '总平面防火设计',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>2#楼与1#楼贴临处的墙体，较高一侧设置为防火墙，防火间距不限，各楼与周边建筑之间均满足防火间距的要求</li>
              <li>本工程沿建筑周边设置环形消防车道，均可方便消防队员进入楼内起火层展开灭火救援工作</li>
              <li>消防车转弯半径按9m设计，消防车道能承受30t消防车的压力，消防车道净宽度和净高度均不小于4.0m，坡度均小于8%</li>
              <li>建筑二层以上的楼层，在每层外墙上设置两个消防救援窗，消防救援窗符合相关规范的规定</li>
            </ul>`
          }
        ]
      },
      {
        id: '10.3',
        chapterId: 'chapter-10-3',
        type: 'subchapter',
        title: '防火分区',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `本工程不设置自动喷水灭火系统，按此条件确定每个防火分区最大面积：1#、2#楼均按自然层划分防火分区，每个防火分区面积均不大于2500m²。`
          }
        ]
      },
      {
        id: '10.4',
        chapterId: 'chapter-10-4',
        type: 'subchapter',
        title: '安全疏散',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<p>疏散宽度指标根据《中小学设计规范》(GB50099-2011)8.2.3表，五层建筑安全出口、疏散走道、疏散楼梯和房间疏散门等处每100人的净宽度为1.05m计算。</p>
            <p>疏散人数指标：教室：根据班级人数确定，每班50人；食堂：食堂座位数×1.1计算(本项目食堂不设厨房)；会议室：按座位数×1.1计算；办公室：按9m²/人计算；校史展厅：按0.75人/m²计算；宿舍：按床位计算，每间4床。</p>
            <p>具体疏散计算：</p>
            <ul>
              <li>1#楼1层宿舍疏散人数：4(间)×4(人/间)+1(人)(值班室)=17(人)，需要疏散宽度：17/100×1.05=0.2m</li>
              <li>1#楼2层宿舍疏散人数：25(间)×4(人/间)=100(人)，需要疏散宽度：100/100×1.05=1.1m</li>
              <li>1#楼3-5层宿舍疏散人数：19(间)×4(人/间)=76(人)，需要疏散宽度：100/100×1.05=1.1m</li>
              <li>1#楼1层食堂疏散人数：500(座)×1.1=550(人)，需要疏散宽度：550/100×1.05=5.8m</li>
              <li>2#教学楼各层疏散人数和宽度计算详见设计文件</li>
            </ul>
            <p>综上设计疏散宽度大于需要疏散宽度，满足规范要求。</p>`
          }
        ]
      },
      {
        id: '10.5',
        chapterId: 'chapter-10-5',
        type: 'subchapter',
        title: '防火构造和设施',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>防火墙采用加气混凝土砌块，防火墙应直接设置在承重结构构件上</li>
              <li>竖向管道井在管道安装就位后，层间二次浇注钢筋混凝土</li>
              <li>甲级防火门耐火极限1.5小时，乙级防火门耐火极限1.0小时，丙级防火门0.5小时</li>
              <li>救援窗口：本项目每栋建筑二层以上楼层的每层外墙上设置两处供消防救援人员进入的窗口</li>
            </ul>`
          }
        ]
      },
      {
        id: '10.6',
        chapterId: 'chapter-10-6',
        type: 'subchapter',
        title: '保温材料',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>外墙外保温层材料采用岩棉保温板(燃烧性能A级)</li>
              <li>屋面保温材料采用聚氨酯发泡(燃烧性能B2级)</li>
            </ul>`
          }
        ]
      },
      {
        id: '10.7',
        chapterId: 'chapter-10-7',
        type: 'subchapter',
        title: '消防设施',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>本工程消防水池、消防泵房利用原校区的水池及泵房</li>
              <li>各场所按要求均匀布置手提式磷酸铵盐干粉灭火器</li>
            </ul>`
          }
        ]
      }
    ],
    paragraphs: []
  },
  {
    id: '11',
    chapterId: 'chapter-11',
    type: 'chapter',
    title: '无障碍设计',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: [
      {
        id: '11.1',
        chapterId: 'chapter-11-1',
        type: 'subchapter',
        title: '设计依据',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>《无障碍设计规范》GB50763-2012</li>
              <li>《建筑与市政工程无障碍通用规范》GB55019-2021</li>
            </ul>`
          }
        ]
      },
      {
        id: '11.2',
        chapterId: 'chapter-11-2',
        type: 'subchapter',
        title: '设计部位',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `所有建筑入口及入口平台、候梯厅、公共走道、相关内外门、无障碍电梯、公共厕所等部位均应按《无障碍设计规范》及《建筑与市政工程无障碍通用规范》的相关要求进行无障碍设计。`
          }
        ]
      },
      {
        id: '11.3',
        chapterId: 'chapter-11-3',
        type: 'subchapter',
        title: '具体要求',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>建筑入口设台阶时，应同时设置轮椅坡道和扶手</li>
              <li>坡道的坡度应不大于1/12</li>
              <li>供轮椅通行的门净宽不应小于0.8m</li>
              <li>供轮椅通行的推拉门和平开门，在门把手一侧的墙面应留不小于0.5m的墙面宽度</li>
              <li>供轮椅通行的门扇，应安装视线观察玻璃、横执把手和关门拉手</li>
              <li>门槛高度及门内外地面高差不应大于0.15m，并应以斜坡过渡</li>
              <li>建筑入口平台宽度不应小于2.00m。供轮椅通行的走道和通道净宽不应小于1.2m</li>
              <li>无障碍停车位满足总车位1%的要求</li>
              <li>其他相关无障碍设施的设置及做法参照《建筑无障碍设计》(12J926)</li>
              <li>景观设计应保证道路、公共绿地的无障碍系统与城市道路的无障碍设施相连接</li>
              <li>无障碍电梯的设置要求符合《无障碍设计规范》GB50763-2012第3.7条</li>
              <li>本项目无障碍信息交流设施需满足《建筑与市政工程无障碍通用规范》第4章要求</li>
              <li>无障碍通道两侧的墙上安装并突出墙面大于100mm的消火栓箱等箱体均采用落地式装修</li>
            </ul>`
          }
        ]
      }
    ],
    paragraphs: []
  },
  {
    id: '12',
    chapterId: 'chapter-12',
    type: 'chapter',
    title: '隔声、降噪、减震设计',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: [
      {
        id: '12.1',
        chapterId: 'chapter-12-1',
        type: 'subchapter',
        title: '设计依据',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>《建筑环境通用规范》GB55016-2021</li>
              <li>《民用建筑隔声设计规范》GB50118-2010</li>
            </ul>`
          }
        ]
      },
      {
        id: '12.2',
        chapterId: 'chapter-12-2',
        type: 'subchapter',
        title: '建筑声环境',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>室内应减少噪声干扰，应采取隔声、吸声、消声、隔振等措施使建筑声环境满足使用功能要求</li>
              <li>本项目声环境功能区分类属于1类</li>
              <li>建筑物外部噪声源传播至主要功能房间室内的噪声限值应符合相关规定</li>
              <li>建筑内部建筑设备传播至主要功能房间室内的噪声限值及主要功能房间室内振动级限值详见相关表格</li>
            </ul>`
          },
          {
            type: 'table',
            content: {}
          },
          {
            type: 'table',
            content: {}
          }
        ]
      },
      {
        id: '12.3',
        chapterId: 'chapter-12-3',
        type: 'subchapter',
        title: '隔声措施',
        hasContent: true,
        loading: false,
        actions: ['continue', 'rewrite'],
        children: [],
        paragraphs: [
          {
            type: 'text',
            content: `<ul>
              <li>本项目教学楼、宿舍楼外墙不面对运动场；本项目教学楼内无音乐教室、舞蹈教室等产生噪声的房间</li>
              <li>建筑物内设有配电间、供暖泵房、水箱间等设备用房，水泵等设备选用低噪声产品，并做减震隔声措施</li>
              <li>本项目宿舍与楼梯间、盥洗室、卫生间、浴室、洗衣房贴临处的房间隔墙做隔声降噪措施</li>
              <li>走廊吊顶采用穿孔吸声板，降噪系数不低于0.4</li>
              <li>本项目宿舍楼的电梯井道设计时避免了与寝室毗邻</li>
              <li>屋顶水箱间楼面构造中设置减震垫</li>
              <li>水、暖、电管线穿过楼板和墙体时，孔洞周边应采取密闭隔声措施</li>
            </ul>`
          }
        ]
      }
    ],
    paragraphs: []
  },
  {
    id: '13',
    chapterId: 'chapter-13',
    type: 'chapter',
    title: '建筑施工注意事项',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: [],
    paragraphs: [
      {
        type: 'text',
        content: `<ul>
          <li>总平面图城市道路标高、用地红线定位均应按市政测量控制坐标网中X轴与Y轴的坐标值定位，并应征得有关部门认可批准后方能施工</li>
          <li>建筑单体应按其定位坐标放线后，复核总平面上所注明的距离用地红线尺寸是否一致，确定无误后方可施工</li>
          <li>本工程建筑和装饰用料的选用，规格及色彩应满足设计要求，所有选用产品均应有国家有关部门的质量鉴定证书</li>
          <li>在选用建筑材料，室内装修材料以及选择施工工艺时，应控制有害物质的含量</li>
          <li>工程施工安装必须严格遵守国家和地方颁发的各项施工质量、操作规程、验收规范</li>
          <li>除注明外，集水井、明沟处、在其周围1米范围内向排水点找1%坡度，明沟内纵坡为1%</li>
        </ul>`
      },
      {
        type: 'table',
        content: {}
      }
    ]
  },
  {
    id: '14',
    chapterId: 'chapter-14',
    type: 'chapter',
    title: '其他',
    hasContent: true,
    loading: false,
    actions: ['continue', 'rewrite'],
    children: [],
    paragraphs: [
      {
        type: 'text',
        content: `<ul>
          <li>施工中所有钢构件连接节点一律满焊</li>
          <li>防水层上各设备专业穿墙套管处做钢性防水套管，其具体尺寸及位置详见各专业图纸</li>
          <li>本工程施工图中标高数值以米为单位，其余尺寸均以毫米为单位，楼层标高为面层标高，屋面标高为结构层标高</li>
          <li>凡在空心砌块外墙上固定设备平台等栏杆的部位，栏杆固定件所在位置空心砌块应采用实心砌块</li>
          <li>本项目砂浆均采用预拌砂浆，预拌砂浆应满足《预拌砂浆应用技术规程》JGJ/T223-2010相关要求</li>
          <li>其它未尽事宜，除详见施工图纸外，均须按照中华人民共和国现行有关施工、安装工程施工验收规范及标准的要求进行施工</li>
        </ul>`
      },
      {
        type: 'table',
        content: {}
      }
    ]
  }
]