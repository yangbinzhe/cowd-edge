import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DataTable from './DataTable.vue';

describe('DataTable pagination', () => {
  it('paginates large result sets without removing rows from the underlying contract', async () => {
    const rows = Array.from({ length: 61 }, (_, index) => ({ id: `row-${index + 1}`, status: 'ready' }));
    const wrapper = mount(DataTable, { props: { rows, columns: ['id', 'status'], rowKey: 'id', pageSize: 25 } });

    expect(wrapper.findAll('tbody tr')).toHaveLength(25);
    expect(wrapper.text()).toContain('row-1');
    expect(wrapper.text()).not.toContain('row-26');
    await wrapper.findAll('.data-table-pagination button')[1].trigger('click');
    expect(wrapper.text()).toContain('row-26');
    expect(wrapper.text()).not.toContain('row-1');
    await wrapper.findAll('.data-table-pagination button')[1].trigger('click');
    expect(wrapper.findAll('tbody tr')).toHaveLength(11);
    expect(wrapper.text()).toContain('row-61');
  });
});
